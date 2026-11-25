import { callText, callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { Scene } from "../models/Scene.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Types } from "mongoose";
import { usesLatinVideoPrompt, videoPromptStructure } from "../utils/videoPromptLanguage.js";
import { z } from "zod";

export interface OptimizeResult {
  analysisReport: string;
  mappingTable: string;
  timingReport: string;
  optimizedClips: string[];   // one string per clip
  elevenLabsScript: string;   // "" if no dialogue
  bgmSpec: string;
  validationReport: string;
  raw: string;
}

// parse LLM markdown output into sections
function parseSections(raw: string): Omit<OptimizeResult, "raw"> {
  // --- JSON path: Gemini sometimes returns a JSON object instead of markdown ---
  const trimmed = raw.trim();
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const jsonStr = trimmed.slice(jsonStart, trimmed.lastIndexOf("}") + 1);
      const obj = JSON.parse(jsonStr);

      // map known JSON key variants to our fields
      const pick = (...keys: string[]): string => {
        for (const k of keys) {
          const val = obj[k] ?? obj[k.toLowerCase()] ?? obj[k.replace(/ /g, "_").toLowerCase()];
          if (val && typeof val === "string") {
            // strip leading ## heading line if present
            return val.replace(/^##[^\n]+\n/, "").trim();
          }
        }
        return "";
      };

      const optimizedRaw = pick(
        "optimized_minimax_h3_prompt", "optimized_prompt", "optimized_h3_prompt",
        "Optimized MiniMax H3 Prompt"
      );
      const clipBlocks = optimizedRaw
        .split(/(?=\n?#{2,4}\s+Clip\s+\d)/i)
        .map(s => s.trim()).filter(s => s.length > 20);

      return {
        analysisReport: pick("prompt_analysis_report", "analysis_report", "Prompt Analysis Report"),
        mappingTable: pick("subject_and_picture_mapping_table", "subject_picture_mapping", "mapping_table", "Subject & Picture Mapping Table"),
        timingReport: pick("dialogue_timing_calibration_report", "timing_report", "Dialogue Timing Calibration Report"),
        optimizedClips: clipBlocks.length > 0 ? clipBlocks : [optimizedRaw],
        elevenLabsScript: pick("elevenlabs_dialogue_script", "elevenlabs_script", "ElevenLabs Dialogue Script"),
        bgmSpec: pick("bgm_spec", "bgm_specification", "BGM Spec"),
        validationReport: pick("validation_report", "Validation Report"),
      };
    } catch {
      // JSON parse failed — fall through to markdown parser
    }
  }

  // --- Markdown path ---
  const text = raw.replace(/\r\n/g, "\n");

  // extract content under a ## heading, stopping only at the next ## heading (not ###)
  const extract = (patterns: string[]): string => {
    for (const heading of patterns) {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:^|\n)#{1,2}\\s+${escaped}\\s*\n([\\s\\S]*?)(?=\n#{1,2}\\s|$)`, "i");
      const m = text.match(re);
      if (m) return m[1].trim();
    }
    return "";
  };

  const optimizedSection = extract([
    "Optimized MiniMax H3 Prompt", "Optimized Prompt", "Optimized H3 Prompt",
  ]);

  // split into per-clip blocks: split on ### Clip N or --- separator
  const clipBlocks = optimizedSection
    .split(/(?=\n?###\s+Clip\s+\d|\n?---\s*\n)/i)
    .map(s => s.replace(/^---\s*\n/, "").trim())
    .filter(s => s.length > 20);

  return {
    analysisReport: extract(["Prompt Analysis Report", "Analysis Report"]),
    mappingTable: extract(["Subject & Picture Mapping Table", "Subject and Picture Mapping", "Subject & Picture Mapping", "Mapping Table"]),
    timingReport: extract(["Dialogue Timing Calibration Report", "Dialogue Timing Calibration", "Timing Calibration Report"]),
    optimizedClips: clipBlocks.length > 0 ? clipBlocks : [optimizedSection],
    elevenLabsScript: extract(["ElevenLabs Dialogue Script", "ElevenLabs Script", "ElevenLabs Dialogue"]),
    bgmSpec: extract(["BGM Spec", "BGM Specification", "Background Music Spec"]),
    validationReport: extract(["Validation Report", "Validation"]),
  };
}

export async function runOptimizeScene(
  sceneId: string,
  maxClipSec?: number,
  imageRefFormat: "@Image" | "<Picture>" = "@Image"
): Promise<OptimizeResult> {
  const scene = await Scene.findById(sceneId)
    .populate<{ locationId: { name: string; masterPrompt: string } }>("locationId", "name masterPrompt")
    .lean();
  if (!scene) throw new Error(`Scene ${sceneId} not found`);

  const clips = (scene.clips as any[]) ?? [];
  if (clips.length === 0) throw new Error("No clips found — run Step 6 first");

  // ดึง characters เพื่อรู้ว่ามี reference images ไหน
  const characters = await Character.find(
    { _id: { $in: scene.characterIds ?? [] } },
    { name: 1, appearanceBlock: 1, referenceImages: 1 }
  ).lean() as unknown as Array<{
    _id: Types.ObjectId; name: string; appearanceBlock: string;
    referenceImages?: Array<{ url: string; approved: boolean }>;
  }>;

  const loc = scene.locationId as unknown as { name: string; masterPrompt: string } | null;

  // สร้าง reference image context — ลำดับต้องตรงกับ referenceSlots ใน DB:
  // characters ก่อน (ตาม scene.characterIds) แล้วค่อย location ทีหลัง
  const refImageLines: string[] = [];
  let picIdx = 1;
  const formatRef = (n: number) => imageRefFormat === "@Image" ? `@Image ${n}` : `<Picture ${n}>`;
  // characters first (matches shortDramaPrompt.service.ts references order)
  const charOrder = ((scene.characterIds as unknown as Types.ObjectId[]) ?? []).map(id => characters.find(c => c._id.equals(id))).filter((c): c is typeof characters[number] => !!c);
  for (const c of charOrder) {
    const approved = c.referenceImages?.find(r => r.approved);
    if (approved) {
      refImageLines.push(`${formatRef(picIdx++)} (Character "${c.name}"): ${c.appearanceBlock} [VERIFIED — reference image available at ${approved.url}]`);
    } else {
      refImageLines.push(`${formatRef(picIdx++)} (Character "${c.name}"): ${c.appearanceBlock} [UNVERIFIED — no approved reference image]`);
    }
  }
  // location last
  if (loc) {
    refImageLines.push(`${formatRef(picIdx++)} (Location "${loc.name}"): ${loc.masterPrompt || "no prompt"} [UNVERIFIED — no image file provided]`);
  }

  const sc = scene as unknown as { sceneCode: string; title: string; mood?: string };
  const maxDurLine = maxClipSec
    ? `User-specified max clip duration: ${maxClipSec} seconds.`
    : "Max clip duration: not specified by user — flag compliance as UNVERIFIED.";

  const allClipPrompts = clips.map((c: any, i: number) =>
    `### Clip ${i + 1} (${c.clipCode}, ${c.durationSec}s)\n\`\`\`\n${c.videoPrompt}\n\`\`\``
  ).join("\n\n");

  const imageRefNote = imageRefFormat === "@Image"
    ? "Use `@Image N` format for all image references in the optimized prompt (e.g. `Linked to @Image 1`)."
    : "Use `<Picture N>` format for all image references in the optimized prompt (e.g. `Linked to <Picture 1>`)."

  const userPrompt = `## Scene: ${sc.sceneCode} — ${sc.title}
Mood: ${sc.mood ?? ""}
${maxDurLine}
Image reference format: ${imageRefNote}

## Available Reference Images
${refImageLines.length > 0 ? refImageLines.join("\n") : "(none)"}

## DY Prompts from Step 6 (${clips.length} clip${clips.length > 1 ? "s" : ""})
${allClipPrompts}

---
Optimize the above prompt(s) according to the validation rules. Output all 7 required sections in order. For the Optimized MiniMax H3 Prompt section, output in DY format as specified in Rule 8a.`;

  const raw = await callText({
    system: loadPrompt("s7-optimize.txt"),
    user: userPrompt,
    temperature: 0.2,
    maxTokens: 32000,
  });

  const sections = parseSections(raw);

  // auto-translate optimizedClips ที่มีภาษาไทยนอก <d> tags
  sections.optimizedClips = await Promise.all(sections.optimizedClips.map(async clip => {
    if (!clip || usesLatinVideoPrompt(clip)) return clip;
    const structure = videoPromptStructure(clip);
    try {
      const { data } = await callStructured({
        system: "Translate the production text of this video prompt into idiomatic English, including location and appearance descriptions, shot directions, sound and delivery cues. Preserve the formatting, heading names, timing, reference IDs and speaker IDs. Only approved speech inside existing <d> tags stays in its original language. Copy each entire <d> block exactly and leave it with its original speaker and shot. Return JSON with the full prompt as videoPrompt.",
        user: JSON.stringify({ videoPrompt: clip }),
        schema: z.object({ videoPrompt: z.string().trim().min(1) }).refine(
          ({ videoPrompt }) => usesLatinVideoPrompt(videoPrompt) && videoPromptStructure(videoPrompt) === structure,
          "Translate all text outside dialogue tags into English and preserve the tags and prompt structure.",
        ),
        temperature: 0.1,
      });
      return data.videoPrompt;
    } catch {
      return clip; // ถ้า translate ไม่สำเร็จ ใช้ค่าเดิม
    }
  }));

  // fallback: ถ้า parse ไม่ได้เลย ให้ใส่ raw ทั้งหมดใน analysisReport
  const hasAnyContent = sections.analysisReport || sections.optimizedClips.some(c => c.length > 0);
  if (!hasAnyContent) {
    sections.analysisReport = raw;
    sections.optimizedClips = [raw];
  }

  // บันทึกลง scene
  await Scene.findByIdAndUpdate(sceneId, {
    $set: { optimizedClips: { ...sections, raw } },
  });

  return { ...sections, raw };
}
