import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callStructured } from "../src/llm/client.js";

const { llm } = vi.hoisted(() => ({
  llm: {
    provider: "openai",
    apiKey: "test-key",
    model: "default-model",
    baseUrl: "https://api.openai.com/v1",
    vision: { apiKey: "test-key", model: "default-model" },
  },
}));
vi.mock("../src/config/index.js", () => ({ config: { llm } }));

const options = {
  system: "Write a short Thai drama scene.",
  user: "Write one spoken line.",
  schema: z.object({ dialogue: z.string().min(1) }),
  maxTokens: 1024,
};

function completed(text: string) {
  return Response.json({
    object: "response",
    status: "completed",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 30, output_tokens: 10 },
  });
}

beforeEach(() => { llm.apiKey = "test-key"; });
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI Responses provider", () => {
  it("uses the chosen model and retries a result that fails the app schema", async () => {
    const request = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(completed('{"dialogue":""}'))
      .mockResolvedValueOnce(completed('{"dialogue":"ไปกันเถอะ"}'));
    vi.stubGlobal("fetch", request);

    expect(await callStructured({ ...options, model: "override-model" })).toEqual({
      data: { dialogue: "ไปกันเถอะ" },
      tokens: { in: 60, out: 20 },
    });
    const [url, init] = request.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "override-model", input: `${options.user}\n\nReturn one valid JSON object only.`,
      max_output_tokens: 1024, store: false, text: { format: { type: "json_object" } },
    });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).input).toContain("แก้ error ก่อนหน้า");
  });

  it("uses a larger output budget after a truncated response", async () => {
    const request = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({
        object: "response", status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [],
      }))
      .mockResolvedValueOnce(completed('{"dialogue":"ไปกันเถอะ"}'));
    vi.stubGlobal("fetch", request);

    expect((await callStructured(options)).data.dialogue).toBe("ไปกันเถอะ");
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).max_output_tokens).toBe(1536);
  });

  it("stops on a model refusal and does not send the input to another provider", async () => {
    const request = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({
      object: "response", status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Unable to process." }] }],
    }));
    vi.stubGlobal("fetch", request);
    await expect(callStructured(options)).rejects.toMatchObject({ status: 422 });
    expect(request).toHaveBeenCalledOnce();
  });

  it("returns a setup error before making a request when the OpenAI key is missing", async () => {
    const request = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", request);
    llm.apiKey = "";
    await expect(callStructured(options)).rejects.toThrow("OPENAI_API_KEY");
    expect(request).not.toHaveBeenCalled();
  });

  it("reports authentication failure without exposing the upstream key error", async () => {
    const request = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(Response.json({
      error: { message: "Private upstream credential detail", code: "invalid_api_key" },
    }, { status: 401 }));
    vi.stubGlobal("fetch", request);
    await expect(callStructured(options)).rejects.toMatchObject({
      status: 401,
      message: "OpenAI API Key ใช้ไม่ได้ กรุณาตรวจค่าที่เซิร์ฟเวอร์",
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
