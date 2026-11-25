import { Types } from "mongoose";
import { z } from "zod";
import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { SceneVideoPromptDraft, type SceneVideoPromptDraftType } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { PropObject } from "../models/PropObject.js";
import { Project } from "../models/Project.js";
import { runShortDramaPrompt, type CharacterReference, type DramaScene, type PropReference } from "./shortDramaPrompt.service.js";
import { assembleDY } from "../templates/dy.js";
import { usesLatinVideoDirection, usesLatinVideoPrompt, videoPromptStructure } from "../utils/videoPromptLanguage.js";
import { outfitImageKeys } from "../utils/imageReferenceKeys.js";
import { cameraAngleFromDirection, cameraSetupDirection, isPortraitRatio, type CameraSetup, type DramaCameraAngle, type PortraitFraming } from "../utils/dramaCamera.js";
import { continuesFromNeighbor, validateSceneCameraHandoff } from "./sceneCameraHandoff.js";

// S4a: LLM สร้างแค่ visual description + camera ต่อ shot
// S4b: map dialogue จาก S3 + แบ่ง clips + ประกอบ DY prompt

const ShotVisualResult = z.object({
  title: z.string(),
  sceneType: z.string(),
  summary: z.string(),
  openingBlocking: z.string().trim().refine(usesLatinVideoDirection).default(""),
  visualTone: z.string(),
  soundscape: z.string(),
  music: z.string(),
  retentionNotes: z.record(z.string(), z.string()).default({}),
  shots: z.array(z.object({
    order: z.number().int(),
    camera: z.string(),        // e.g. "slow push-in, eye-level"
    lighting: z.string(),      // e.g. "warm backlight, soft shadows"
    description: z.string(),   // rich visual description with tokens
    endBlocking: z.string().trim().refine(usesLatinVideoDirection).default(""),
  })).min(1),
});

export async function runPromptGeneration(
  sceneId: string
): Promise<{ clips: Array<{ durationSec: number; prompt: string }>; validationErrors: string[] }> {
  const baseScene = await Scene.findById(sceneId).lean<DramaScene>();
  if (!baseScene) throw new Error(`Scene ${sceneId} not found`);
  if (baseScene.dramaBeat) return runShortDramaPrompt(baseScene);

  const scene = await Scene.findById(sceneId)
    .populate<{ locationId: { _id: Types.ObjectId; name: string; locationBlock: string } }>("locationId", "name locationBlock")
    .lean();
  if (!scene) throw new Error(`Scene ${sceneId} not found`);

  const project = await Project.findById(scene.projectId).lean();
  if (!project) throw new Error("Project not found");

  const characters = await Character.find({
    _id: { $in: scene.characterIds ?? [] },
    status: "approved",
  }).lean<CharacterReference[]>();

  const loc = scene.locationId as unknown as { _id: Types.ObjectId; name: string; locationBlock: string } | null;
  const locationBlock = loc?.locationBlock ?? "";
  const locationName = loc?.name ?? "location";
  const locationId = loc?._id?.toString() ?? "";

  // ดึง shots จาก S3
  const s3shots = await Shot.find({ sceneId }).sort({ order: 1 }).lean() as unknown as Array<{
    _id: Types.ObjectId; order: number; durationSec: number;
    breakQuality: string; shotType: string; camera?: string; cameraAngle?: DramaCameraAngle; action: string; emotion: string;
    cameraSetup?: CameraSetup;
    portraitFraming?: PortraitFraming | null;
    direction?: { blocking: string; endBlocking?: string; performance: string; cut: string; backgroundActivity: string };
    characterIds: Types.ObjectId[];
    propIds: Types.ObjectId[];
    dialogue: Array<{ speakerId?: Types.ObjectId; lineTh?: string; tone?: string; source: string }>;
  }>;
  const previous = await validateSceneCameraHandoff(baseScene, s3shots);
  const continuing = continuesFromNeighbor(baseScene, previous);

  // resolve propIds → prop names per shot
  const allPropIds = [...new Set(s3shots.flatMap(sh => sh.propIds?.map(id => id.toString()) ?? []))];
  const props = allPropIds.length
    ? (await PropObject.find({ projectId: scene.projectId, _id: { $in: allPropIds } }).select("name visualPrompt description").lean<PropReference[]>())
      .map(prop => ({ id: String(prop._id), name: prop.name, visualPrompt: prop.visualPrompt || prop.description || "" }))
    : [];
  const propIdToName = new Map(props.map(prop => [prop.id, prop.name]));
  const shotPropNames = s3shots.map(shot =>
    (shot.propIds ?? []).flatMap(id => {
      const name = propIdToName.get(String(id));
      return name ? [name] : [];
    }),
  );
  const charIdToId = new Map(characters.map(c => [c._id.toString(), c._id.toString()]));
  const charContext = characters.map((c) => `- ID: ${c._id} | name: ${c.name}`).join("\n");

  const propContext = props.length > 0
    ? props.map(p => `- ${p.name}: ${p.visualPrompt}`).join("\n")
    : "(none)";

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

  const styleGuide = (project as unknown as { styleGuide?: { artStyle?: string; aspectRatio?: string; promptPrefix?: string; negativePrompt?: string } }).styleGuide;

  const sc = scene as unknown as { sceneCode: string; title: string; mood?: string; summary?: string };
  const videoModel = (project as unknown as { videoModel?: { maxDurationSec?: number } }).videoModel;

  const shotList = s3shots.map((sh, i) => {
    const tones = sh.dialogue.map(d => d.tone).filter(Boolean).join(", ");
    const hasDialogue = sh.dialogue.some(d => d.lineTh?.trim());
    return [
      `Shot ${sh.order} [${sh.shotType}] ${sh.durationSec}s [${sh.breakQuality}]${hasDialogue ? " [HAS_DIALOGUE — use MLS or closer]" : ""}`,
      `  action: ${translatedActions[i]}`,
      sh.camera ? `  planned camera: ${sh.camera}` : null,
      sh.cameraAngle ? `  planned camera angle: ${sh.cameraAngle}` : null,
      sh.cameraSetup ? `  planned camera setup: ${cameraSetupDirection(sh.cameraSetup)}` : null,
      sh.portraitFraming && isPortraitRatio(styleGuide?.aspectRatio ?? "16:9")
        ? `  portrait framing to preserve: ${JSON.stringify(sh.portraitFraming)}` : null,
      sh.direction ? `  planned direction: ${JSON.stringify(sh.direction)}` : null,
      shotPropNames[i].length ? `  props: ${shotPropNames[i].join(", ")}` : null,
      `  emotion: ${sh.emotion || "neutral"}`,
      tones ? `  dialogue_tone: ${tones}` : null,
    ].filter(Boolean).join("\n");
  }).join("\n");

  const userPrompt = `## Scene: ${sc.sceneCode} — ${sc.title}
Location: ${locationName} | Mood: ${sc.mood ?? ""} | Summary: ${sc.summary ?? ""}
Art style: ${styleGuide?.artStyle ?? "photorealistic live-action"}${styleGuide?.aspectRatio ? ` | Aspect ratio: ${styleGuide.aspectRatio}` : ""}

## Characters (use {{char:ID}} tokens in description; IDs listed below)
${charContext || "(none)"}

## Props from Bible (use {{prop:NAME}} token when prop appears in shot)
${propContext}

## Shots from S3 — FIXED (do NOT change order, duration, or count)
${shotList}

${continuing && previous?.endBlocking ? `Previous clip's end state: ${previous.endBlocking}
Translate it into openingBlocking. The first shot starts at that physical state, from the new camera angle. Continue any movement in progress without replaying an arrival or approach.` : ""}

## Your task
For EACH of the ${s3shots.length} shots above, provide:
- camera: describe the planned placement, angle and movement. When a camera setup is supplied, the app inserts its focal length, shot size and camera-to-subject distance. Keep the active speaker prominent in any planned portrait close-up.
- lighting: lighting quality + color temperature + shadow direction (e.g. "warm golden backlight, soft rim on left, deep shadows")
- description: 2–3 sentence cinematic visual description. Include:
  • subject positions and body language using {{char:ID}} / {{loc:${locationId}}} tokens
  • key visual details (clothing, environment elements, and the props listed for this shot, referenced by {{prop:NAME}})
  • emotional atmosphere matching the shot's emotion and mood
  • continuity of action, positions and eyelines from the previous shot, following the planned cut
  • the approved portrait framing, focal characters and near/far placement when supplied
  • DO NOT include dialogue text here

Also provide scene-level fields: title, sceneType, summary, visualTone, soundscape, music, retentionNotes
When the plan supplies direction.endBlocking, translate it to the shot's endBlocking as a plain English snapshot, without clip-local subject numbers. Return empty openingBlocking when there is no previous end state.

## Return JSON:
{
  "title": "...", "sceneType": "...", "summary": "...", "visualTone": "...",
  "soundscape": "...", "music": "...", "openingBlocking": "",
  "retentionNotes": { "<characterId>": "what to preserve visually" },
  "shots": [
    { "order": 1, "camera": "...", "lighting": "...", "description": "...", "endBlocking": "" },
    ...exactly ${s3shots.length} shots...
  ]
}`;

  const { data: visual } = await callStructured({
    system: loadPrompt("s4a-prompt.txt"),
    user: userPrompt,
    schema: ShotVisualResult.refine(visual =>
      (!continuing || !previous?.endBlocking || !!visual.openingBlocking) &&
      s3shots.every(shot => !shot.direction?.endBlocking ||
        visual.shots.some(output => output.order === shot.order && !!output.endBlocking)),
      "Translate all supplied opening and ending blocking snapshots into English."),
    temperature: 0.3,
    maxTokens: 8000,
  });

  // map visual + S3 dialogue → SceneVideoPromptDraft format
  const visualMap = new Map(visual.shots.map(sh => [sh.order, sh]));

  const draftShots: SceneVideoPromptDraftType["shots"] = s3shots.map((sh, i) => {
    const vis = visualMap.get(sh.order) ?? visual.shots[i];

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
      camera: vis?.camera ?? "",
      endBlocking: vis?.endBlocking,
      cameraSetup: sh.cameraSetup,
      cameraAngle: sh.cameraAngle ?? cameraAngleFromDirection(sh.camera),
      lighting: vis?.lighting ?? "",
      description: vis?.description ?? translatedActions[i] ?? "",
      dialogue,
      charactersInShot: sh.characterIds.map(id => id.toString()).filter(id => charIdToId.has(id)),
      propsInShot: shotPropNames[i],
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

  const { clips: assembledClips, validationErrors } = assembleDY({
    draft,
    openingBlocking: continuing ? visual.openingBlocking : undefined,
    locationId,
    locationBlock,
    locationName,
    characters: characters.map(c => {
      const id = String(c._id);
      const outfit = c.outfits?.[0];
      return {
        id,
        appearanceBlock: [outfit?.referenceAppearance || c.appearanceBlock, outfit?.outfitPrompt || outfit?.description].filter(Boolean).join(". "),
        name: outfit?.name ? `${c.name} · ${outfit.name}` : c.name,
        resourceKey: outfitImageKeys({ ...c, _id: id })[0],
      };
    }),
    props,
    referencePictures: [],
    dialogueLanguage,
    clipPolicy,
    promptPrefix: styleGuide?.promptPrefix ?? "DY",
    artStyle: styleGuide?.artStyle,
    aspectRatio: styleGuide?.aspectRatio,
    negativePrompt: styleGuide?.negativePrompt,
  });

  const clips = await Promise.all(assembledClips.map(async clip => {
    if (usesLatinVideoPrompt(clip.prompt)) return clip;
    const structure = videoPromptStructure(clip.prompt);
    const { data } = await callStructured({
      system: "Translate the production text of this video prompt into idiomatic English, including location and appearance descriptions, shot directions, sound and delivery cues. Preserve the formatting, heading names, camera angle and lens/framing labels, timing, reference IDs and speaker IDs. Only approved speech inside existing <d> tags stays in its original language. Copy each entire <d> block exactly and leave it with its original speaker and shot. Return JSON with the full prompt as videoPrompt.",
      user: JSON.stringify({ videoPrompt: clip.prompt }),
      schema: z.object({ videoPrompt: z.string().trim().min(1) }).refine(
        ({ videoPrompt }) => usesLatinVideoPrompt(videoPrompt) && videoPromptStructure(videoPrompt) === structure,
        "Translate all text outside dialogue tags into English and preserve the tags and prompt structure.",
      ),
      temperature: 0.1,
    });
    return { ...clip, prompt: data.videoPrompt };
  }));

  const sceneClips = clips.map((clip, i) => ({
    clipCode: `${sc.sceneCode}-C${String(i + 1).padStart(2, "0")}`,
    shotIds: clip.shotIds.map(id => s3shots[Number(id)]._id),
    startOffsetSec: clips.slice(0, i).reduce((s, c) => s + c.durationSec, 0),
    durationSec: clip.durationSec,
    referencePictures: [],
    videoPrompt: clip.prompt,
    referenceSlots: clip.referenceSlots,
    speakerCharacterIds: clip.speakerCharacterIds,
    promptVersion: (baseScene.clips[i]?.promptVersion ?? 0) + 1,
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
