import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config/index.js";

type InlineImage = { mimeType: "image/jpeg"; data: string };

export interface CallStructuredOpts<T extends z.ZodTypeAny> {
  system: string;
  user: string;
  schema: T;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  maxRetries?: number;
  image?: InlineImage;
}

export interface TokenUsage { in: number; out: number }
export interface StructuredResult<T> { data: T; tokens: TokenUsage }

const MAX_TOKENS_CAP = 65536;

export class LLMOutputValidationError extends Error {}

export class LLMRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class GeminiRequestError extends Error {
  constructor(readonly status: number, details: string) {
    super(`Gemini API error ${status}: ${details}`);
  }
}

function isGeminiNative(): boolean {
  return config.llm.provider === "gemini";
}

function reportOpenAIError(error: unknown): never {
  if (error instanceof OpenAI.APIError) {
    switch (error.status) {
      case 400:
        throw new LLMRequestError(400, "OpenAI ปฏิเสธรูปแบบคำขอ กรุณาตรวจการตั้งค่าโมเดล");
      case 401:
        throw new LLMRequestError(401, "OpenAI API Key ใช้ไม่ได้ กรุณาตรวจค่าที่เซิร์ฟเวอร์");
      case 403:
      case 404:
        throw new LLMRequestError(error.status, "บัญชีหรือโปรเจกต์ OpenAI นี้เข้าใช้โมเดลที่ตั้งไว้ไม่ได้");
      case 429:
        throw new LLMRequestError(429, "OpenAI จำกัดจำนวนคำขอหรือเครดิตไม่พอ กรุณาตรวจโควตาหรือลองใหม่");
    }
  }
  throw new LLMRequestError(503, "เชื่อมต่อ OpenAI ไม่สำเร็จ กรุณาลองอีกครั้ง");
}

async function requestOpenAI(client: OpenAI, opts: {
  model: string; system: string; user: string; maxTokens: number; image?: InlineImage;
}) {
  const { model, system, user, maxTokens, image } = opts;
  const inputText = `${user}\n\nReturn one valid JSON object only.`;
  const response = await client.responses.create({
    model,
    instructions: system,
    input: image ? [{ role: "user", content: [
      { type: "input_text", text: inputText },
      { type: "input_image", detail: "high", image_url: `data:${image.mimeType};base64,${image.data}` },
    ] }] : inputText,
    text: { format: { type: "json_object" } },
    max_output_tokens: maxTokens,
    store: false,
  }).catch(reportOpenAIError);
  const incomplete = response.incomplete_details?.reason;
  const refused = response.output.some(item =>
    item.type === "message" && item.content.some(part => part.type === "refusal"));
  if (refused || incomplete === "content_filter") {
    throw new LLMRequestError(422, "Content filter blocked response (OpenAI)");
  }
  if (response.status && response.status !== "completed" && incomplete !== "max_output_tokens") {
    throw new LLMRequestError(502, "OpenAI ตอบกลับไม่สำเร็จ กรุณาลองอีกครั้ง");
  }
  return {
    text: response.output_text,
    finishReason: incomplete === "max_output_tokens" ? "length" : "stop",
    tokensIn: response.usage?.input_tokens ?? 0,
    tokensOut: response.usage?.output_tokens ?? 0,
  };
}

async function callGeminiNative(opts: {
  model: string; apiKey: string; system: string; user: string;
  maxTokens: number; temperature: number;
  jsonMode?: boolean;
  novelInSystem?: boolean;
  image?: InlineImage;
}): Promise<{ text: string; finishReason: string; tokensIn: number; tokensOut: number; blocked?: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent?key=${opts.apiKey}`;
  const useJson = opts.jsonMode !== false;

  // novelInSystem: move user content into system_instruction to bypass promptFeedback filter
  const systemText = opts.novelInSystem
    ? `${opts.system}\n\n---\n\n${opts.user}`
    : opts.system;
  const userText = opts.novelInSystem
    ? "Process the content provided in the system instructions and return the required JSON."
    : opts.user;

  const res = await fetch(url, {
    method: "POST",
    ...(opts.image && { signal: AbortSignal.timeout(90_000) }),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: userText }, ...(opts.image ? [{ inlineData: opts.image }] : [])] }],
      generationConfig: {
        ...(useJson ? { responseMimeType: "application/json" } : {}),
        maxOutputTokens: opts.maxTokens,
        temperature: opts.temperature,
      },
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new GeminiRequestError(res.status, err.slice(0, 300));
  }

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };

  const blockReason = json.promptFeedback?.blockReason;
  if (blockReason) {
    console.error("[Gemini] BLOCKED promptFeedback:", JSON.stringify(json.promptFeedback));
    console.error("[Gemini] user prompt preview:", opts.user.slice(0, 200));
    return { text: "", finishReason: "stop", tokensIn: json.usageMetadata?.promptTokenCount ?? 0, tokensOut: 0, blocked: blockReason };
  }

  const candidate = json.candidates?.[0];
  const candidateBlock = candidate?.finishReason;
  if (candidateBlock === "SAFETY" || candidateBlock === "PROHIBITED_CONTENT") {
    console.error("[Gemini] BLOCKED candidate:", candidateBlock, JSON.stringify((candidate as any)?.safetyRatings));
    // ถ้า candidate มี partial text ให้ลองใช้ก่อน
    const partialText = candidate?.content?.parts?.map(p => p.text ?? "").join("") ?? "";
    if (partialText.trim().length > 10) {
      console.warn("[Gemini] using partial text despite block:", partialText.slice(0, 100));
      return { text: partialText, finishReason: "stop", tokensIn: json.usageMetadata?.promptTokenCount ?? 0, tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0 };
    }
    return { text: "", finishReason: "stop", tokensIn: json.usageMetadata?.promptTokenCount ?? 0, tokensOut: 0, blocked: candidateBlock };
  }
  console.log("[Gemini] OK finishReason:", candidate?.finishReason, "tokensIn:", json.usageMetadata?.promptTokenCount, "tokensOut:", json.usageMetadata?.candidatesTokenCount);
  return {
    text: candidate?.content?.parts?.map(p => p.text ?? "").join("") ?? "",
    finishReason: candidate?.finishReason ?? "stop",
    tokensIn: json.usageMetadata?.promptTokenCount ?? 0,
    tokensOut: json.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

export async function callGeminiDiagnose(model: string, apiKey: string, userText: string): Promise<string | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: 10 },
    }),
  });
  if (!res.ok) return null;
  const json = await res.json() as { promptFeedback?: { blockReason?: string } };
  return json.promptFeedback?.blockReason ?? null;
}

export async function callStructured<T extends z.ZodTypeAny>(
  opts: CallStructuredOpts<T>
): Promise<StructuredResult<z.infer<T>>> {
  const useOpenAI = config.llm.provider === "openai";
  const selected = opts.image ? config.llm.vision : config.llm;
  const model = opts.model ?? selected.model;
  const maxRetries = opts.maxRetries ?? 2;
  const useGeminiNative = !useOpenAI && (!!opts.image || isGeminiNative());
  if (!selected.apiKey) {
    throw new LLMRequestError(503, useOpenAI ? "ตั้งค่า OPENAI_API_KEY ที่เซิร์ฟเวอร์ก่อนใช้งาน" : "ตั้งค่า API Key ของ AI ก่อนใช้งาน");
  }
  const client = useGeminiNative ? null : new OpenAI({
    baseURL: config.llm.baseUrl,
    apiKey: selected.apiKey,
    ...(useOpenAI && { timeout: 180_000, maxRetries: 0 }),
  });

  let lastError = "";
  let totalIn = 0;
  let totalOut = 0;
  let currentMaxTokens = opts.maxTokens ?? 16000;

  for (let i = 0; i <= maxRetries; i++) {
    const userContent = opts.user + (lastError && !lastError.startsWith("length:") ? `\n\nแก้ error ก่อนหน้า: ${lastError}` : "");

    let finishReason: string;
    let text: string;

    if (useOpenAI) {
      const result = await requestOpenAI(client!, {
        model, system: opts.system, user: userContent, maxTokens: currentMaxTokens, image: opts.image,
      });
      finishReason = result.finishReason;
      text = result.text;
      totalIn += result.tokensIn;
      totalOut += result.tokensOut;
    } else if (useGeminiNative) {
      const r = await callGeminiNative({
        model, apiKey: selected.apiKey,
        system: opts.system, user: userContent,
        maxTokens: currentMaxTokens, temperature: opts.temperature ?? 0.2, image: opts.image,
      });

      if (r.blocked) {
        if (opts.image) throw new Error(`Gemini could not analyze the reference image [${r.blocked}]`);
        // retry 1: novelInSystem (bypasses promptFeedback filter on user turn)
        console.warn(`[Gemini] ${r.blocked} — retrying with novelInSystem=true`);
        const r1b = await callGeminiNative({
          model, apiKey: config.llm.apiKey,
          system: opts.system, user: userContent,
          maxTokens: currentMaxTokens, temperature: opts.temperature ?? 0.2,
          novelInSystem: true,
        });
        if (!r1b.blocked) {
          finishReason = r1b.finishReason;
          text = r1b.text;
          totalIn += r1b.tokensIn;
          totalOut += r1b.tokensOut;
        } else {
          // retry 2: fallback model + novelInSystem
          const fallbackModel = "gemini-3.5-flash";
          console.warn(`[Gemini] still blocked — retrying with fallback model ${fallbackModel} + novelInSystem`);
          const r2 = await callGeminiNative({
            model: fallbackModel, apiKey: config.llm.apiKey,
            system: opts.system, user: userContent,
            maxTokens: currentMaxTokens, temperature: opts.temperature ?? 0.2,
            novelInSystem: true,
          });
          if (!r2.blocked) {
            finishReason = r2.finishReason;
            text = r2.text;
            totalIn += r2.tokensIn;
            totalOut += r2.tokensOut;
          } else {
            throw new Error(`Gemini blocked prompt [${r2.blocked}] even with fallback model`);
          }
        }
      } else {
        finishReason = r.finishReason;
        text = r.text;
        totalIn += r.tokensIn;
        totalOut += r.tokensOut;
      }
    } else {
      const res = await client!.chat.completions.create({
        model,
        max_tokens: currentMaxTokens,
        temperature: opts.temperature ?? 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: userContent },
        ],
      });
      totalIn += res.usage?.prompt_tokens ?? 0;
      totalOut += res.usage?.completion_tokens ?? 0;
      const choice = res.choices[0];
      finishReason = choice?.finish_reason ?? "";
      text = choice?.message?.content ?? "";
    }

    console.log(`[callStructured] attempt=${i} finishReason=${finishReason} tokens_out=${totalOut} text_len=${text.length}`);

    if (finishReason === "length" || finishReason === "MAX_TOKENS") {
      const next = Math.min(Math.ceil(currentMaxTokens * 1.5), MAX_TOKENS_CAP);
      lastError = `length:${currentMaxTokens}`;
      currentMaxTokens = next;
      continue;
    }

    if (finishReason.startsWith("content_filter") || finishReason === "SAFETY") {
      throw new Error(`Content filter blocked response (${finishReason})`);
    }

    try {
      const raw = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
      const json = JSON.parse(raw);
      const data = opts.schema.parse(json);
      return { data, tokens: { in: totalIn, out: totalOut } };
    } catch (e: unknown) {
      lastError = String(e instanceof Error ? e.message : e).slice(0, 500);
      console.warn(`[callStructured] attempt=${i} validation error:`, lastError);
    }
  }

  throw new LLMOutputValidationError(`LLM output validation failed after ${maxRetries + 1} attempts: ${lastError}`);
}

// Plain text (markdown) call — no JSON schema, returns raw string
export async function callText(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  const model = opts.model ?? config.llm.model;
  if (isGeminiNative()) {
    const r = await callGeminiNative({
      model, apiKey: config.llm.apiKey,
      system: opts.system, user: opts.user,
      maxTokens: opts.maxTokens ?? 16000,
      temperature: opts.temperature ?? 0.2,
      jsonMode: false,
    });
    if (r.blocked) {
      const r2 = await callGeminiNative({
        model, apiKey: config.llm.apiKey,
        system: opts.system, user: opts.user,
        maxTokens: opts.maxTokens ?? 16000,
        temperature: opts.temperature ?? 0.2,
        jsonMode: false, novelInSystem: true,
      });
      if (r2.blocked) throw new Error(`Gemini blocked [${r2.blocked}]`);
      return r2.text;
    }
    return r.text;
  }
  // OpenAI-compatible
  const client = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: config.llm.apiKey });
  const res = await (client as any).chat.completions.create({
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    max_tokens: opts.maxTokens ?? 16000,
    temperature: opts.temperature ?? 0.2,
  });
  return res.choices[0]?.message?.content ?? "";
}
