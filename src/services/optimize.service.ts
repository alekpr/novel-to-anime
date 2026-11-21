import { callText } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { Scene } from "../models/Scene.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Types } from "mongoose";

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

  const extract = (patterns: string[]): string => {
    for (const heading of patterns) {
      const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:^|\n)#{1,3}\\s+${escaped}\\s*\n([\\s\\S]*?)(?=\n#{1,3}\\s|$)`, "i");
      const m = text.match(re);
      if (m) return m[1].trim();
    }
    return "";
  };

  const optimizedSection = extract([
    "Optimized MiniMax H3 Prompt", "Optimized Prompt", "Optimized H3 Prompt",
  ]);
  const clipBlocks = optimizedSection
    .split(/(?=\n?#{2,4}\s+Clip\s+\d|\n?---\s*\n)/i)
    .map(s => s.trim()).filter(s => s.length > 20);

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
  maxClipSec?: number
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

  // สร้าง reference image context
  const refImageLines: string[] = [];
  let picIdx = 1;
  if (loc) {
    refImageLines.push(`<Picture ${picIdx++}>: Location "${loc.name}" — ${loc.masterPrompt || "no prompt"} [UNVERIFIED — no image file provided]`);
  }
  for (const c of characters) {
    const approved = c.referenceImages?.find(r => r.approved);
    if (approved) {
      refImageLines.push(`<Picture ${picIdx++}>: Character "${c.name}" — ${c.appearanceBlock} [VERIFIED — reference image available at ${approved.url}]`);
    } else {
      refImageLines.push(`<Picture ${picIdx++}>: Character "${c.name}" — ${c.appearanceBlock} [UNVERIFIED — no approved reference image]`);
    }
  }

  const sc = scene as unknown as { sceneCode: string; title: string; mood?: string };
  const maxDurLine = maxClipSec
    ? `User-specified max clip duration: ${maxClipSec} seconds.`
    : "Max clip duration: not specified by user — flag compliance as UNVERIFIED.";

  const allClipPrompts = clips.map((c: any, i: number) =>
    `### Clip ${i + 1} (${c.clipCode}, ${c.durationSec}s)\n\`\`\`\n${c.videoPrompt}\n\`\`\``
  ).join("\n\n");

  const userPrompt = `## Scene: ${sc.sceneCode} — ${sc.title}
Mood: ${sc.mood ?? ""}
${maxDurLine}

## Available Reference Images
${refImageLines.length > 0 ? refImageLines.join("\n") : "(none)"}

## DY Prompts from Step 6 (${clips.length} clip${clips.length > 1 ? "s" : ""})
${allClipPrompts}

---
Optimize the above prompt(s) according to the validation rules. Output all 7 required sections.`;

  const raw = await callText({
    system: loadPrompt("s7-optimize.txt"),
    user: userPrompt,
    temperature: 0.2,
    maxTokens: 16000,
  });

  const sections = parseSections(raw);

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
