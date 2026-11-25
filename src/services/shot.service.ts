import { callStructured, GeminiRequestError, LLMOutputValidationError } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { ShotListResult, type LLMShotType } from "../schemas/llm.js";
import type { RefinementCtx } from "zod";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { PropObject } from "../models/PropObject.js";
import { Job } from "../models/Job.js";
import { Project } from "../models/Project.js";
import { queues } from "../queues/jobRunner.js";
import { DRAMA_REPLAN_MESSAGE, alignDramaShotTiming, fitsDramaScene, hasInvalidDramaScenes, shotTimeline } from "../utils/shortDrama.js";
import { dramaSpeechSeconds, isImmediateScriptedReply, isSpokenLine, matchScriptedDramaDialogue, scriptedDramaDialogue } from "../utils/dramaDialogue.js";
import { CAMERA_FRAMINGS, cameraAngleFromDirection, DRAMA_CAMERA_ANGLES, distinctDramaAngles, estimatePortraitFrameHeightM,
  isPortraitRatio, PORTRAIT_DIALOGUE_MAX_FRAME_HEIGHT_M, type DramaCameraAngle } from "../utils/dramaCamera.js";
import { config } from "../config/index.js";
import { continuesFromNeighbor, readNeighbor } from "./sceneCameraHandoff.js";

type SceneLean = Record<string, any>;
type EpisodeLean = Record<string, any>;
type CharLean = Record<string, any>;
const activeDramaShotWork = new Set<string>();

export class ShotGenerationError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function upstreamStatus(error: unknown) {
  if (error instanceof GeminiRequestError) return error.status;
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") return error.status;
  return undefined;
}

function isTemporaryUpstreamError(error: unknown): boolean {
  const status = upstreamStatus(error);
  return status === 408 || (status !== undefined && status >= 500) ||
    (error instanceof TypeError && error.message === "fetch failed");
}

function reportShotModelError(error: unknown, sceneCode: string): never {
  const status = upstreamStatus(error);
  if (error instanceof LLMOutputValidationError) {
    throw new ShotGenerationError(502, `${sceneCode} · AI ส่งช็อตไม่ครบเงื่อนไขเรื่องเวลา บทพูด ระยะเลนส์ การจัดเฟรม หรือมุมกล้องที่รอยต่อซีน กรุณาลองสร้างซีนนี้อีกครั้ง`);
  }
  if (status === 429) {
    throw new ShotGenerationError(429, `${sceneCode} · ผู้ให้บริการ AI จำกัดจำนวนคำขอหรือโควตา กรุณาลองใหม่ภายหลัง`);
  }
  if (status === 401 || status === 403) {
    throw new ShotGenerationError(502, `${sceneCode} · ผู้ให้บริการ AI ปฏิเสธการเข้าถึง กรุณาตรวจการตั้งค่า API`);
  }
  if (isTemporaryUpstreamError(error)) {
    throw new ShotGenerationError(503, `${sceneCode} · ติดต่อ AI ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง`);
  }
  if (error instanceof Error && /^(Gemini blocked prompt|Content filter blocked response)/.test(error.message)) {
    throw new ShotGenerationError(422, `${sceneCode} · ผู้ให้บริการ AI ปฏิเสธการประมวลผลเนื้อหาของซีนนี้`);
  }
  throw new ShotGenerationError(502, `${sceneCode} · ผู้ให้บริการ AI ตอบกลับไม่สำเร็จ กรุณาลองใหม่อีกครั้ง`);
}

export async function withDramaShotWork<T>(episodeId: string, work: () => Promise<T>) {
  if (activeDramaShotWork.has(episodeId)) {
    throw new ShotGenerationError(409, "ตอนนี้กำลังสร้างหรืออนุมัติช็อต กรุณารอให้งานปัจจุบันเสร็จก่อน");
  }
  activeDramaShotWork.add(episodeId);
  try {
    return await work();
  } finally {
    activeDramaShotWork.delete(episodeId);
  }
}

export function buildShotsForScene(
  scene: SceneLean,
  episode: EpisodeLean,
  characters: CharLean[],
  prevSummary?: string,
) {
  const generate = () => generateShotsForScene(scene, episode, characters, prevSummary);
  return scene.dramaBeat ? withDramaShotWork(String(scene.episodeId), generate) : generate();
}

async function generateShotsForScene(
  scene: SceneLean,
  episode: EpisodeLean,
  characters: CharLean[],
  prevSummary?: string,
): Promise<{ sceneSummary: string; tokensIn: number; tokensOut: number }> {
  const shortDrama = !!scene.dramaBeat;
  const sceneDurationSec = scene.estDurationSec ?? 30;
  if (hasInvalidDramaScenes([scene])) throw new Error(DRAMA_REPLAN_MESSAGE);
  const useGemini = config.llm.provider === "gemini";
  const [previous, next, project] = await Promise.all([
    readNeighbor({ episodeId: scene.episodeId, order: scene.order }, true),
    readNeighbor({ episodeId: scene.episodeId, order: scene.order }, false),
    Project.findById(scene.projectId).select("styleGuide.aspectRatio").lean<{ styleGuide?: { aspectRatio?: string } }>(),
  ]);
  const aspectRatio = project?.styleGuide?.aspectRatio ?? (shortDrama ? "9:16" : "16:9");
  const portrait = isPortraitRatio(aspectRatio);
  const dialogueBudgetSec = scene.dramaBeat?.dialogueBudgetSec as number | undefined;
  const plannedOpening = scene.dramaBeat?.openingAngle as DramaCameraAngle | undefined;
  const plannedClosing = scene.dramaBeat?.closingAngle as DramaCameraAngle | undefined;
  const opening = plannedOpening && (!previous?.angle || distinctDramaAngles(plannedOpening, previous.angle)) ? plannedOpening : undefined;
  const closing = plannedClosing && (!next?.angle || distinctDramaAngles(plannedClosing, next.angle)) ? plannedClosing : undefined;
  const previousSummary = prevSummary ?? previous?.summary ?? episode.summary ?? "";

  const charactersById = new Map(characters.map(character => [String(character._id), character]));
  const sceneChars = ((scene.characterIds ?? []) as unknown[]).flatMap(id => {
    const character = charactersById.get(String(id));
    return character ? [character] : [];
  });
  let dialoguePurpose = scene.dramaBeat?.dialoguePurpose as string | undefined;
  // Older plans had no dialogue marker. Give the first scene with approved cast a spoken beat.
  if (shortDrama && dialoguePurpose === undefined && sceneChars.length) {
    const firstCastScene = await Scene.findOne({
      episodeId: scene.episodeId,
      dramaBeat: { $exists: true },
      characterIds: { $in: characters.map(character => character._id) },
    }).sort({ order: 1 }).select("_id").lean();
    if (String(firstCastScene?._id) === String(scene._id)) {
      dialoguePurpose = "ใช้คำพูดสั้น ๆ ขยับเหตุการณ์สำคัญของซีน";
    }
  }
  if (dialoguePurpose && !sceneChars.length) {
    throw new ShotGenerationError(409, `${scene.sceneCode} · เพิ่มตัวละครที่อนุมัติในซีนที่ต้องมีบทพูดก่อน`);
  }

  const charMap = new Map((shortDrama ? sceneChars : characters).map((c) => [c.name, c]));

  // Gemini: ใช้ CHAR_N | DeepSeek: ใช้ชื่อจริง
  const charIndexMap = new Map(sceneChars.map((c, i) => [c.name as string, `CHAR_${i + 1}`]));
  const charReverseMap = new Map(sceneChars.map((c, i) => [`CHAR_${i + 1}`, c.name as string]));
  const characterTokens = [...charIndexMap].sort(([a], [b]) => b.length - a.length);
  const toPromptNames = (value: string) => useGemini
    ? characterTokens.reduce((text, [name, token]) => text.split(name).join(token), value)
    : value;
  const toCharacterName = (ref: string) => charReverseMap.get(ref.trim().toUpperCase()) ?? ref.trim();
  const replaceChar = (text: string) => useGemini
    ? text.replace(/CHAR_\d+/g, token => charReverseMap.get(token) ?? token)
    : text;
  const handoffText = (neighbor: typeof previous) => neighbor
    ? [neighbor.sceneCode, neighbor.angle, neighbor.camera, neighbor.frame]
      .filter((value): value is string => !!value).map(toPromptNames).join(" | ")
    : "none";
  const continuing = continuesFromNeighbor(
    { locationId: scene.locationId, timeOfDay: scene.timeOfDay, dramaBeat: scene.dramaBeat }, previous,
  );
  const openingHandoff = continuing ? `Same-place, same-time opening: match the previous clip's final physical blocking.
Previous ending state: ${toPromptNames(previous?.endBlocking ?? scene.dramaBeat?.entry ?? "Hold the continuing characters in their final positions.")}
At the first instant, preserve the actors' positions relative to landmarks, distance, posture, eyelines and held props. Change viewpoint on the same side of the axis. Continue the action already in progress or the next reply from there. Do not replay an entrance or approach.` : "";

  const charContext = useGemini
    ? sceneChars.map((c, i) => `- CHAR_${i + 1} (${c.personality ?? ""}) | speechHabits: [${(c.voice?.speechHabits ?? []).join(", ")}]`).join("\n")
    : sceneChars.map((c) => `- ${c.name} (${c.personality ?? ""}) | speechHabits: [${(c.voice?.speechHabits ?? []).join(", ")}]`).join("\n");

  const sceneParagraphs = (episode.paragraphs as { idx: number; text: string }[])
    .filter((p: any) => {
      const from = (scene.sourceRange as { fromParagraph?: number } | null)?.fromParagraph ?? 0;
      const to = (scene.sourceRange as { toParagraph?: number } | null)?.toParagraph ?? 999;
      return (p.idx ?? 0) >= from && (p.idx ?? 0) <= to;
    });
  const sceneText = sceneParagraphs.map(p => `[${p.idx}] ${p.text}`).join("\n\n");
  const requiredDialogue = shortDrama ? scriptedDramaDialogue(sceneParagraphs) : [];
  const requiredSpeechSec = dramaSpeechSeconds(requiredDialogue);
  if (requiredSpeechSec > sceneDurationSec) {
    throw new ShotGenerationError(409, `${scene.sceneCode} · บทต้นฉบับใช้เวลาพูดประมาณ ${requiredSpeechSec.toFixed(1)} วินาที กรุณาแบ่งซีนที่จบประโยคหรือปรับเวลาซีน`);
  }

  const charNameField = useGemini ? `"characterNames": ["CHAR_1"]` : `"characterNames": ["ชื่อตัวละคร"]`;
  const speakerField = useGemini ? `"speakerName": "CHAR_1"` : `"speakerName": "ชื่อตัวละคร"`;

  // ดึง props ของ project
  const sceneProps = await PropObject.find({ projectId: scene.projectId }, { name: 1 }).lean() as unknown as Array<{ name: string }>;
  const propContext = sceneProps.length > 0 ? sceneProps.map(p => `- ${p.name}`).join("\n") : "(none)";

  const userPrompt = `
## Scene: ${scene.sceneCode}
TimeOfDay: ${scene.timeOfDay ?? ""} | Mood: ${scene.mood ?? ""} | Frame: ${aspectRatio} | Total duration: ${shortDrama ? sceneDurationSec : scene.estDurationSec ?? 30}s
${shortDrama ? `Beat: ${toPromptNames(scene.summary ?? "")}
${continuing ? openingHandoff : `Start frame: ${toPromptNames(scene.dramaBeat.entry ?? "")}`}
End frame: ${toPromptNames(scene.dramaBeat.exit ?? "")}
${dialoguePurpose ? `Dialogue purpose: ${toPromptNames(dialoguePurpose)}. Carry the whole exchange that advances this beat, with each speaker visible.` : ""}
${requiredDialogue.length ? `Required source dialogue, in order. Keep the full wording and speaker. Allocate at least ${(Math.ceil(requiredSpeechSec * 10) / 10).toFixed(1)}s for these lines; start speaking while the action is happening:
${requiredDialogue.map(({ idx, speaker, lineTh }) => `[${idx}] ${toPromptNames(speaker)}: ${toPromptNames(lineTh)} (~${dramaSpeechSeconds([{ lineTh }]).toFixed(1)}s)`).join("\n")}`
    : dialogueBudgetSec !== undefined ? `Planned speech: about ${dialogueBudgetSec}s. Recalculate from the actual words before choosing shot durations.` : ""}
Previous scene closing shot: ${handoffText(previous)}
Next scene opening shot: ${handoffText(next)}
Opening camera angle${portrait ? " suggestion (adapt for portrait framing)" : ""}: ${opening ?? "choose a clearly different angle from the previous closing shot"}
Closing camera angle${portrait ? " suggestion (adapt for portrait framing)" : ""}: ${closing ?? "choose a clearly different angle from the next opening shot"}
cameraAngle values: ${DRAMA_CAMERA_ANGLES.join(", ")}. A front/three-quarter, three-quarter/profile, or high/overhead pair is too similar at a scene cut.
Render this scene as one clip. All shots must total exactly ${sceneDurationSec}s, with a clean handoff at the end of the scene.
Generate only this beat. Keep approved names and preserve the original spoken language; label shortened lines as generated.` : `
${openingHandoff}
Previous scene closing shot: ${handoffText(previous)}
Next scene opening shot: ${handoffText(next)}
At each scene boundary, change the physical viewpoint while continuing the action and keeping the screen direction. If the duration requires multiple clips, plan distinct angles at natural cut points.
cameraAngle values: ${DRAMA_CAMERA_ANGLES.join(", ")}.`}

## Characters in this scene
${charContext || "(none)"}

## Props from Bible (use exact names in propNames field)
${propContext}

## Previous summary
${toPromptNames(previousSummary) || "(start of EP)"}

## Scene text
${toPromptNames(sceneText)}

## Return JSON:
\`\`\`json
{
  "shots": [
    {
      "order": 1,
      "shotType": "${portrait ? "medium" : "wide"}",
      "camera": "ตำแหน่งจริง ระดับกล้อง ระยะจากตัวละคร และการเคลื่อนกล้องภาษาไทย",
      "cameraSetup": ${portrait
        ? '{ "focalLengthMm": 65, "framing": "medium close-up", "subjectDistanceM": 1.25 }'
        : '{ "focalLengthMm": 65, "framing": "medium-wide shot" }'},
      "cameraAngle": "side-profile",${portrait ? `\n      "portraitFraming": { "layout": "single", "focusCharacterNames": [${useGemini ? '"CHAR_1"' : '"ชื่อตัวละคร"'}], "placement": "ตัวละครอยู่ระยะหน้า มีพื้นที่ด้านที่หันมอง" },` : ""}
      "durationSec": 4,
      "direction": { "blocking": "ตำแหน่ง/ทิศ/พร็อพ", "endBlocking": "ท่า ตำแหน่งเทียบกับฉาก ระยะระหว่างคน ทิศมอง และของในมือในเฟรมสุดท้าย", "performance": "สีหน้า/แววตา/ภาษากาย", "cut": "ชนิด/จังหวะตัด", "backgroundActivity": "การเคลื่อนไหวฉากหลัง" },
      "breakQuality": "hard",
      ${charNameField},
      "propNames": [],
      "action": "บรรยายการกระทำภาษาไทย",
      "emotion": "อารมณ์ภาษาไทย",
      "dialogue": [{ ${speakerField}, "lineTh": "บทพูดภาษาไทย", "tone": "tone in English", "source": "original" }],
      "narration": "คำบรรยายภาษาไทย หรือ null",
      "sfx": "",
      "music": ""
    }
  ],
  "sceneSummary": "สรุปภาษาไทย"
}
\`\`\`

**กฎภาษา:** camera, action, emotion, narration, sceneSummary ต้องเป็นภาษาไทย | tone เป็น English
**Enum rules:** shotType: wide/medium/close-up/OTS/insert/POV — breakQuality: hard/soft/avoid — source: original/generated
**Camera setup:** focalLengthMm is a numeric full-frame-equivalent focal length chosen for the shot. framing must be one of ${CAMERA_FRAMINGS.join(", ")}. The JSON shows example values only.
**Null rules:** sfx, music, camera, action, emotion ต้องเป็น string ใช้ "" แทน null
`.trim();

  function validatePortraitShots(shots: LLMShotType[], ctx: RefinementCtx) {
    if (!portrait) return;
    shots.forEach((shot, index) => {
      const framing = shot.portraitFraming;
      const visible = new Set(shot.characterNames.map(toCharacterName));
      const focusNames = framing?.focusCharacterNames.map(toCharacterName) ?? [];
      const focus = new Set(focusNames);
      const speakers = [...new Set(
        shot.dialogue.filter(line => isSpokenLine(line.lineTh)).map(line => toCharacterName(line.speakerName)),
      )];
      const expectedFocus = framing?.layout === "depth-two-shot" ? 2
        : framing?.layout === "single" || framing?.layout === "over-the-shoulder" ? 1 : undefined;
      if (!framing || (expectedFocus !== undefined && focus.size !== expectedFocus) ||
          [...focus].some(name => !visible.has(name))) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "portraitFraming"], message:
          "Supply the 9:16 composition and place the layout's focal character(s) from characterNames in the frame." });
      }
      if (!speakers.length) return;
      const { focalLengthMm, framing: shotSize, subjectDistanceM } = shot.cameraSetup;
      if (expectedFocus === undefined || ["wide", "establishing", "insert"].includes(shot.shotType) ||
          (shotSize !== "medium close-up" && shotSize !== "close-up")) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "cameraSetup", "framing"], message:
          "Use a medium close-up (chest up) or a close-up (head and shoulders) of the active speaker in a portrait dialogue shot. Use a single, tight over-the-shoulder or a tight two-shot with a clear focus handoff." });
      } else {
        const maxHeight = PORTRAIT_DIALOGUE_MAX_FRAME_HEIGHT_M[shotSize];
        const maxDistance = Math.floor(maxHeight * focalLengthMm / 36 * 100) / 100;
        if (subjectDistanceM === undefined || estimatePortraitFrameHeightM(focalLengthMm, subjectDistanceM) > maxHeight) {
          ctx.addIssue({ code: "custom", path: ["shots", index, "cameraSetup", "subjectDistanceM"], message:
            `Set subjectDistanceM to the farthest distance from the camera to the active speaker while speaking. For a ${focalLengthMm} mm ${shotSize} in portrait, use at most about ${maxDistance} m, or choose a lens and camera position that make the face large enough.` });
        }
      }
      if (speakers.some((name, turn) => name !== focusNames[turn])) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "portraitFraming", "focusCharacterNames"], message:
          "The camera's focus must follow the order of speaking: " + speakers.join(", ") +
          ". List these speakers first, in this order, and keep listener reactions secondary while a line is spoken." });
      }
    });
  }

  const schema = shortDrama ? ShotListResult.superRefine(({ shots }, ctx) => {
    validatePortraitShots(shots, ctx);
    if (!shots.at(-1)?.direction?.endBlocking) {
      ctx.addIssue({ code: "custom", path: ["shots", shots.length - 1, "direction", "endBlocking"], message:
        "Describe the actual final frame for the next clip: positions relative to the set, distance between people, posture, eyelines and props." });
    }
    const alignedShots = alignDramaShotTiming(shots, sceneDurationSec);
    if (dialoguePurpose && !alignedShots.some(shot => shot.dialogue.some(line => isSpokenLine(line.lineTh)))) {
      ctx.addIssue({ code: "custom", path: ["shots"], message:
        "This scene requires at least one real spoken line in dialogue with an approved visible speaker. Do not use narration or an ellipsis as a line." });
    }
    const spoken = alignedShots.flatMap((shot, shotIndex) => shot.dialogue.map(line => ({
      speaker: toCharacterName(line.speakerName), lineTh: replaceChar(line.lineTh), shotIndex,
    })));
    const matches = matchScriptedDramaDialogue(requiredDialogue, spoken);
    if (!matches) {
      ctx.addIssue({ code: "custom", path: ["shots"], message:
        "Keep every required source line in order and with its original speaker. Do not shorten the line or drop the reply. Split at a natural phrase only if necessary." });
    } else {
      for (let i = 0; i < matches.length; i++) {
        const immediateReply = i > 0 && isImmediateScriptedReply(requiredDialogue[i - 1], requiredDialogue[i]);
        const startShot = spoken[immediateReply ? matches[i - 1].end : matches[i].start].shotIndex;
        const endShot = spoken[matches[i].end].shotIndex;
        const interruption = alignedShots.findIndex((shot, index) =>
          index > startShot && index < endShot && !shot.dialogue.some(line => isSpokenLine(line.lineTh)));
        if (interruption >= 0) {
          ctx.addIssue({ code: "custom", path: ["shots", interruption], message:
            `There is a silent cutaway ${immediateReply ? "in the exchange leading into" : "inside the spoken line in"} paragraph ${requiredDialogue[i].idx}. Play the action under the dialogue or after the exchange.` });
        }
      }
    }
    if (!fitsDramaScene(alignedShots, sceneDurationSec)) {
      const returnedDuration = shotTimeline(alignedShots).at(-1)?.end ?? 0;
      ctx.addIssue({ code: "custom", path: ["shots"], message:
        `Your shots total ${returnedDuration}s. Fit them to exactly ${sceneDurationSec}s in tenths. Allocate time to the full spoken exchange first, and combine actions that can happen while the characters speak.` });
    }
    const first = alignedShots[0].cameraAngle;
    const last = alignedShots.at(-1)?.cameraAngle;
    if (!first || (!portrait && opening && first !== opening) || (previous?.angle && !distinctDramaAngles(first, previous.angle))) {
      ctx.addIssue({ code: "custom", path: ["shots", 0, "cameraAngle"], message:
        `Use opening angle ${opening ?? "clearly different from the previous scene"}; the previous scene closes on ${previous?.angle ?? previous?.camera ?? "no prior camera"}.` });
    }
    if (!last || (!portrait && closing && last !== closing) || (next?.angle && !distinctDramaAngles(last, next.angle))) {
      ctx.addIssue({ code: "custom", path: ["shots", alignedShots.length - 1, "cameraAngle"], message:
        `Use closing angle ${closing ?? "clearly different from the next scene"}; the next scene opens on ${next?.angle ?? next?.camera ?? "no next camera"}.` });
    }
    let totalSpeech = 0;
    alignedShots.forEach((shot, index) => {
      const visible = new Set(shot.characterNames.map(toCharacterName));
      if (!shot.direction || !shot.camera.trim() || !shot.cameraAngle || !shot.action.trim() ||
          [...visible].some(name => !charMap.has(name)) ||
          shot.dialogue.some(line => !visible.has(toCharacterName(line.speakerName)) || !isSpokenLine(line.lineTh) || !line.tone.trim())) {
        ctx.addIssue({ code: "custom", path: ["shots", index], message: "Supply camera, action and all direction fields. Each line needs a known visible speaker and an explicit vocal tone." });
      }
      const describedAngle = cameraAngleFromDirection(shot.camera);
      if (describedAngle && describedAngle !== shot.cameraAngle) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "camera"], message: "The camera description must show the same physical angle as cameraAngle." });
      }
      const speech = dramaSpeechSeconds(shot.dialogue.map(line => ({ lineTh: replaceChar(line.lineTh) })));
      totalSpeech += speech;
      if (speech > shot.durationSec) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "dialogue"], message:
          `The dialogue needs about ${speech.toFixed(1)}s. Give the full line enough time within the scene; move or combine visual action to make room.` });
      }
    });
    if (dialogueBudgetSec !== undefined && totalSpeech > dialogueBudgetSec + 0.5) {
      console.warn(`[shots] dialogue ${totalSpeech.toFixed(1)}s exceeds budget ${dialogueBudgetSec}s`);
    }
  }) : ShotListResult.superRefine(({ shots }, ctx) => {
    validatePortraitShots(shots, ctx);
    shots.forEach((shot, index) => {
      if (!shot.cameraAngle) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "cameraAngle"], message:
          "Give the planned physical camera angle using one of the supplied values." });
      }
    });
  });
  const request = {
    system: [loadPrompt(shortDrama ? "s3-short-drama.txt" : "s3-shots.txt"), loadPrompt("s3-drama-editing.txt"),
      ...(portrait ? [loadPrompt("s3-portrait-framing.txt")] : [])].join("\n\n"),
    user: userPrompt,
    schema,
    temperature: 0.3,
    maxTokens: 16000,
  };
  const { data, tokens } = await callStructured(request)
    .catch(error => isTemporaryUpstreamError(error) ? callStructured(request) : Promise.reject(error))
    .catch(error => reportShotModelError(error, scene.sceneCode));
  const shots = shortDrama ? alignDramaShotTiming(data.shots, sceneDurationSec) : data.shots;

  const epPrefix = `EP${String(episode.number).padStart(2, "0")}`;
  const sceneNum = String(scene.order).padStart(2, "0");
  const episodeId = scene.episodeId;

  const writing = await Scene.updateOne(
    { _id: scene._id, updatedAt: scene.updatedAt },
    { shotsApproved: false, "clips.$[].stale": true },
  );
  if (!writing.matchedCount) throw new ShotGenerationError(409, "ซีนเปลี่ยนระหว่างสร้างช็อต กรุณาสร้างใหม่");

  for (const sh of shots) {
    const shotCode = `${epPrefix}-S${sceneNum}-SH${String(sh.order).padStart(2, "0")}`;

    // map ชื่อ/CHAR_N → ObjectId
    const characterIds = sh.characterNames
      .map(ref => charMap.get(toCharacterName(ref))?._id)
      .filter(Boolean);

    // resolve propNames → propIds
    const propIds = sh.propNames?.length
      ? (await PropObject.find({ projectId: scene.projectId, name: { $in: sh.propNames } }, { _id: 1 }).lean()).map(p => p._id)
      : [];

    // replace CHAR_N ที่อาจค้างอยู่ใน text fields (Gemini เท่านั้น)
    const replaceChar = (text: string) => {
      if (!useGemini) return text;
      let result = text;
      for (const [idx, name] of charReverseMap) result = result.split(idx).join(name);
      return result;
    };

    const dialogue = sh.dialogue.map((d) => ({
      speakerId: charMap.get(toCharacterName(d.speakerName))?._id,
      lineTh: replaceChar(d.lineTh),
      tone: d.tone,
      source: d.source,
      reviewed: d.source === "original",
    }));

    await Shot.findOneAndUpdate(
      { episodeId, shotCode },
      {
        $set: {
          sceneId: scene._id,
          episodeId,
          order: sh.order,
          shotCode,
          shotType: sh.shotType,
          camera: replaceChar(sh.camera),
          cameraSetup: sh.cameraSetup,
          cameraAngle: sh.cameraAngle ?? cameraAngleFromDirection(sh.camera) ?? null,
          portraitFraming: portrait && sh.portraitFraming ? {
            ...sh.portraitFraming,
            focusCharacterNames: sh.portraitFraming.focusCharacterNames.map(toCharacterName),
            placement: replaceChar(sh.portraitFraming.placement),
          } : null,
          durationSec: sh.durationSec,
          breakQuality: sh.breakQuality,
          characterIds,
          propIds,
          locationId: scene.locationId,
          action: replaceChar(sh.action),
          emotion: replaceChar(sh.emotion),
          direction: sh.direction && {
            blocking: replaceChar(sh.direction.blocking),
            ...(sh.direction.endBlocking ? { endBlocking: replaceChar(sh.direction.endBlocking) } : {}),
            performance: replaceChar(sh.direction.performance),
            cut: replaceChar(sh.direction.cut),
            backgroundActivity: replaceChar(sh.direction.backgroundActivity),
          },
          dialogue,
          narration: sh.narration && replaceChar(sh.narration),
          sfx: sh.sfx,
          music: sh.music,
        },
      },
      { upsert: true, new: true }
    );
  }

  await Shot.deleteMany({ sceneId: scene._id, order: { $nin: shots.map(sh => sh.order) } });
  const totalDur = shortDrama ? sceneDurationSec : shots.reduce((sum, sh) => sum + sh.durationSec, 0);
  await Scene.findByIdAndUpdate(scene._id, {
    shotCount: shots.length,
    totalDurationSec: totalDur,
    ...(shortDrama && { "dramaBeat.clipDurationsSec": [sceneDurationSec] }),
  });

  return { sceneSummary: data.sceneSummary || previousSummary, tokensIn: tokens.in, tokensOut: tokens.out };
}

// ---- S3 job: รัน parallel ทุก scene ----
export async function runShotList(
  projectId: string,
  episodeId: string,
  jobId: string
): Promise<void> {
  const episode = await Episode.findById(episodeId).lean();
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  const scenes = await Scene.find({ episodeId }).sort({ order: 1 }).lean();
  if (scenes.length === 0) throw new Error("No scenes found — run S2 first");
  if (hasInvalidDramaScenes(scenes)) throw new Error(DRAMA_REPLAN_MESSAGE);

  await Job.findByIdAndUpdate(jobId, { status: "running", progress: 0.05, statusMessage: "เตรียมข้อมูล…" });

  const characters = await Character.find({ projectId, status: "approved" }).lean();
  if (scenes.some(scene => scene.dramaBeat) &&
      !scenes.some(scene => scene.dramaBeat && scene.characterIds.some(id => characters.some(character => String(character._id) === String(id))))) {
    throw new ShotGenerationError(409, "ตอนนี้ยังไม่มีซีนที่มีตัวละครอนุมัติสำหรับบทพูด กรุณาตรวจ Bible และแบ่งซีนอีกครั้ง");
  }

  let prevSummary = episode.summary ?? "";
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  let completedScenes = 0;

  const episodeData = episode;
  async function generateScene(scene: typeof scenes[number]) {
    await Job.findByIdAndUpdate(jobId, { statusMessage: `AI กำลังสร้าง shots: ${scene.sceneCode}…` });
    const result = await buildShotsForScene(scene, episodeData, characters, prevSummary);
    completedScenes++;
    totalTokensIn += result.tokensIn;
    totalTokensOut += result.tokensOut;
    prevSummary = result.sceneSummary;
    await Job.findByIdAndUpdate(jobId, {
      progress: 0.05 + (completedScenes / scenes.length) * 0.9,
      statusMessage: `สร้าง shots เสร็จแล้ว ${completedScenes}/${scenes.length} ฉาก`,
    });
  }

  if (scenes.some(scene => scene.dramaBeat)) {
    for (const scene of scenes) await generateScene(scene);
  } else {
    await Promise.all(scenes.map(scene => queues.llm.add(() => generateScene(scene))));
  }

  await Episode.findByIdAndUpdate(episodeId, { status: "shots_review" });
  await Job.findByIdAndUpdate(jobId, {
    status: "succeeded",
    progress: 1,
    "tokens.in": totalTokensIn,
    "tokens.out": totalTokensOut,
    finishedAt: new Date(),
  });
}
