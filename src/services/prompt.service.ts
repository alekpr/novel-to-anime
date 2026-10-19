import { Types } from "mongoose";
import { z } from "zod";
import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { SceneVideoPromptDraft, type SceneVideoPromptDraftType } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Project } from "../models/Project.js";
import { assembleDY } from "../templates/dy.js";

// S4a: LLM สร้างแค่ visual description + camera ต่อ shot
// S4b: map dialogue จาก S3 + แบ่ง clips + ประกอบ DY prompt

const ShotVisualResult = z.object({
  title: z.string(),
  sceneType: z.string(),
  summary: z.string(),
  visualTone: z.string(),
  soundscape: z.string(),
  music: z.string(),
  retentionNotes: z.record(z.string(), z.string()).default({}),
  shots: z.array(z.object({
    order: z.number().int(),
    camera: z.string(),        // e.g. "slow push-in, eye-level"
    lighting: z.string(),      // e.g. "warm backlight, soft shadows"
    description: z.string(),   // rich visual description with tokens
  })).min(1),
});

export async function runPromptGeneration(
  sceneId: string
): Promise<{ clips: Array<{ durationSec: number; prompt: string }>; validationErrors: string[] }> {
  const scene = await Scene.findById(sceneId)
    .populate<{ locationId: { _id: Types.ObjectId; name: string; locationBlock: string } }>("locationId", "name locationBlock")
    .lean();
  if (!scene) throw new Error(`Scene ${sceneId} not found`);

  const project = await Project.findById(scene.projectId).lean();
  if (!project) throw new Error("Project not found");

  const characters = await Character.find({
    _id: { $in: scene.characterIds ?? [] },
    status: "approved",
  }).lean() as unknown as Array<{ _id: Types.ObjectId; name: string; appearanceBlock: string }>;

  const loc = scene.locationId as unknown as { _id: Types.ObjectId; name: string; locationBlock: string } | null;
  const locationBlock = loc?.locationBlock ?? "";
  const locationName = loc?.name ?? "location";
  const locationId = loc?._id?.toString() ?? "";

  // ดึง shots จาก S3
  const s3shots = await Shot.find({ sceneId }).sort({ order: 1 }).lean() as unknown as Array<{
    _id: Types.ObjectId; order: number; durationSec: number;
    breakQuality: string; shotType: string; action: string; emotion: string;
    characterIds: Types.ObjectId[];
    dialogue: Array<{ speakerId?: Types.ObjectId; lineTh?: string; tone?: string; source: string }>;
  }>;

  const charIdToId = new Map(characters.map(c => [c._id.toString(), c._id.toString()]));
  const charContext = characters.map((c) => `- ID: ${c._id} | name: ${c.name}`).join("\n");

  // แปลง action เป็น English สำหรับส่ง LLM
  let translatedActions: string[] = s3shots.map(sh => sh.action);
  if (s3shots.length > 0) {
    const TranslateResult = z.object({ actions: z.array(z.string()) });
    try {
      const { data: tx } = await callStructured({
        system: "Translate Thai action descriptions to concise English. Return JSON only.",
        user: `Translate to English:\n${s3shots.map((sh, i) => `${i + 1}. ${sh.action}`).join("\n")}\n\nReturn: { "actions": ["...", ...] }`,
        schema: TranslateResult,
        temperature: 0.1,
        maxTokens: 2000,
      });
      if (tx.actions.length === s3shots.length) translatedActions = tx.actions;
    } catch { /* ใช้ action เดิม */ }
  }

  const sc = scene as unknown as { sceneCode: string; title: string; mood?: string; summary?: string };
  const videoModel = (project as unknown as { videoModel?: { maxDurationSec?: number } }).videoModel;

  const shotList = s3shots.map((sh, i) => {
    const tones = sh.dialogue.map(d => d.tone).filter(Boolean).join(", ");
    return [
      `Shot ${sh.order} [${sh.shotType}] ${sh.durationSec}s [${sh.breakQuality}]`,
      `  action: ${translatedActions[i]}`,
      `  emotion: ${sh.emotion || "neutral"}`,
      tones ? `  dialogue_tone: ${tones}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n");

  const userPrompt = `## Scene: ${sc.sceneCode} — ${sc.title}
Location: ${locationName} | Mood: ${sc.mood ?? ""} | Summary: ${sc.summary ?? ""}

## Characters (use {{char:ID}} tokens in description; IDs listed below)
${charContext || "(none)"}

## Shots from S3 — FIXED (do NOT change order, duration, or count)
${shotList}

## Your task
For EACH of the ${s3shots.length} shots above, provide:
- camera: specific movement + angle + lens feel (e.g. "slow push-in, low angle, wide lens")
- lighting: lighting quality + color temperature + shadow direction (e.g. "warm golden backlight, soft rim on left, deep shadows")
- description: 2–3 sentence cinematic visual description. Include:
  • subject positions and body language using {{char:ID}} / {{loc:${locationId}}} tokens
  • key visual details (clothing, props, environment elements)
  • emotional atmosphere matching the shot's emotion and mood
  • DO NOT include dialogue text here

Also provide scene-level fields: title, sceneType, summary, visualTone, soundscape, music, retentionNotes

## Return JSON:
{
  "title": "...", "sceneType": "...", "summary": "...", "visualTone": "...",
  "soundscape": "...", "music": "...",
  "retentionNotes": { "<characterId>": "what to preserve visually" },
  "shots": [
    { "order": 1, "camera": "...", "lighting": "...", "description": "..." },
    ...exactly ${s3shots.length} shots...
  ]
}`;

  const { data: visual } = await callStructured({
    system: loadPrompt("s4a-prompt.txt"),
    user: userPrompt,
    schema: ShotVisualResult,
    temperature: 0.3,
    maxTokens: 8000,
  });

  // map visual + S3 dialogue → SceneVideoPromptDraft format
  const visualMap = new Map(visual.shots.map(sh => [sh.order, sh]));

  const draftShots: SceneVideoPromptDraftType["shots"] = s3shots.map((sh) => {
    const vis = visualMap.get(sh.order) ?? visual.shots[s3shots.indexOf(sh)];

    // map dialogue จาก S3 โดยตรง — ใช้ speakerId เป็น characterId
    const dialogue = sh.dialogue
      .filter(d => d.lineTh?.trim())
      .map(d => ({
        speakerCharacterId: d.speakerId?.toString() ?? "",
        tone: d.tone ?? "",
        text: d.lineTh ?? "",
      }))
      .filter(d => d.speakerCharacterId && charIdToId.has(d.speakerCharacterId));

    return {
      durationSec: sh.durationSec,
      beat: {
        breakQuality: sh.breakQuality as "hard" | "soft" | "avoid",
        note: undefined,
      },
      camera: vis ? `${vis.camera}${vis.lighting ? ` | ${vis.lighting}` : ""}` : "",
      description: vis?.description ?? translatedActions[s3shots.indexOf(sh)] ?? "",
      dialogue,
      charactersInShot: sh.characterIds.map(id => id.toString()).filter(id => charIdToId.has(id)),
    };
  });

  const draft: SceneVideoPromptDraftType = {
    title: visual.title,
    sceneType: visual.sceneType,
    summary: visual.summary,
    visualTone: visual.visualTone,
    soundscape: visual.soundscape,
    music: visual.music,
    shots: draftShots,
    retentionNotes: visual.retentionNotes,
  };

  // S4b: แบ่ง clips + ประกอบ DY prompt
  const clipPolicy = {
    maxClipSec: Math.min(
      (project as unknown as { clipPolicy?: { userMaxClipSec?: number } }).clipPolicy?.userMaxClipSec ?? 20,
      videoModel?.maxDurationSec ?? 15
    ),
    targetClipSec: (project as unknown as { clipPolicy?: { targetClipSec?: number } }).clipPolicy?.targetClipSec ?? 12,
    minClipSec: (project as unknown as { clipPolicy?: { minClipSec?: number } }).clipPolicy?.minClipSec ?? 5,
  };

  const dialogueLanguage = (project as unknown as { dialoguePolicy?: { dialogueLanguage?: string } }).dialoguePolicy?.dialogueLanguage ?? "Thai";

  const { clips, validationErrors } = assembleDY({
    draft,
    locationId,
    locationBlock,
    locationName,
    characters: characters.map((c) => ({
      id: c._id.toString(),
      appearanceBlock: c.appearanceBlock,
      name: c.name,
    })),
    referencePictures: [],
    dialogueLanguage,
    clipPolicy,
    promptPrefix: (project as unknown as { styleGuide?: { promptPrefix?: string } }).styleGuide?.promptPrefix ?? "DY",
  });

  const sceneClips = clips.map((clip, i) => ({
    clipCode: `${sc.sceneCode}-C${String(i + 1).padStart(2, "0")}`,
    shotIds: [],
    startOffsetSec: clips.slice(0, i).reduce((s, c) => s + c.durationSec, 0),
    durationSec: clip.durationSec,
    referencePictures: [],
    videoPrompt: clip.prompt,
    promptVersion: 1,
    clipAssetId: null,
    takes: [],
    stale: false,
  }));

  await Scene.findByIdAndUpdate(sceneId, {
    $set: {
      videoPromptDraft: draft,
      clips: sceneClips,
      totalDurationSec: clips.reduce((s, c) => s + c.durationSec, 0),
    },
  });

  return { clips, validationErrors };
}
