import { z } from "zod";
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
  const extract = (heading: string): string => {
    const re = new RegExp(`##\\s+${heading}[\\s\\S]*?(?=\\n##\\s|$)`, "i");
    const m = raw.match(re);
    return m ? m[0].replace(/^##[^\n]+\n/, "").trim() : "";
  };

  // optimizedClips — split by "### Clip" or "#### Clip" boundaries
  const optimizedSection = extract("Optimized MiniMax H3 Prompt");
  const clipBlocks = optimizedSection.split(/(?=###?\s+Clip\s+\d)/i).filter(s => s.trim());
  const optimizedClips = clipBlocks.length > 0 ? clipBlocks.map(s => s.trim()) : [optimizedSection];

  return {
    analysisReport: extract("Prompt Analysis Report"),
    mappingTable: extract("Subject & Picture Mapping Table"),
    timingReport: extract("Dialogue Timing Calibration Report"),
    optimizedClips,
    elevenLabsScript: extract("ElevenLabs Dialogue Script"),
    bgmSpec: extract("BGM Spec"),
    validationReport: extract("Validation Report"),
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

  // บันทึกลง scene
  await Scene.findByIdAndUpdate(sceneId, {
    $set: { optimizedClips: { ...sections, raw } },
  });

  return { ...sections, raw };
}
