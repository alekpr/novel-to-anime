import { callStructured, GeminiRequestError, LLMOutputValidationError } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { ShotListResult } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Job } from "../models/Job.js";
import { queues } from "../queues/jobRunner.js";
import { DRAMA_REPLAN_MESSAGE, alignDramaShotTiming, fitsDramaScene, hasInvalidDramaScenes, shotTimeline } from "../utils/shortDrama.js";
import { dramaSpeechSeconds, isSpokenLine } from "../utils/dramaDialogue.js";
import { cameraAngleFromDirection, DRAMA_CAMERA_ANGLES, distinctDramaAngles, type DramaCameraAngle } from "../utils/dramaCamera.js";
import { config } from "../config/index.js";

type SceneLean = Record<string, any>;
type EpisodeLean = Record<string, any>;
type CharLean = Record<string, any>;
type NeighborScene = {
  _id: unknown;
  sceneCode: string;
  summary?: string;
  dramaBeat?: { entry?: string; exit?: string; openingAngle?: DramaCameraAngle; closingAngle?: DramaCameraAngle };
};
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
    throw new ShotGenerationError(502, `${sceneCode} · AI ส่งช็อตไม่ครบเงื่อนไขเรื่องเวลา บทพูด หรือมุมกล้องที่รอยต่อซีน กรุณาลองสร้างซีนนี้อีกครั้ง`);
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

async function readNeighbor(scene: SceneLean, previous: boolean) {
  const order = previous ? -1 : 1;
  const neighbor = await Scene.findOne({
    episodeId: scene.episodeId,
    order: previous ? { $lt: scene.order } : { $gt: scene.order },
  }).sort({ order }).select("sceneCode summary dramaBeat").lean<NeighborScene>();
  if (!neighbor) return;
  const shot = await Shot.findOne({ sceneId: neighbor._id }).sort({ order })
    .select("camera cameraAngle").lean<{ camera?: string; cameraAngle?: DramaCameraAngle }>();
  const plannedAngle = previous ? neighbor.dramaBeat?.closingAngle : neighbor.dramaBeat?.openingAngle;
  return {
    sceneCode: neighbor.sceneCode,
    summary: neighbor.summary,
    frame: previous ? neighbor.dramaBeat?.exit : neighbor.dramaBeat?.entry,
    camera: shot?.camera,
    angle: shot?.cameraAngle ?? cameraAngleFromDirection(shot?.camera) ?? plannedAngle,
  };
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
  const [previous, next] = shortDrama
    ? await Promise.all([readNeighbor(scene, true), readNeighbor(scene, false)])
    : [undefined, undefined];
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

  const charContext = useGemini
    ? sceneChars.map((c, i) => `- CHAR_${i + 1} (${c.personality ?? ""}) | speechHabits: [${(c.voice?.speechHabits ?? []).join(", ")}]`).join("\n")
    : sceneChars.map((c) => `- ${c.name} (${c.personality ?? ""}) | speechHabits: [${(c.voice?.speechHabits ?? []).join(", ")}]`).join("\n");

  const sceneText = (episode.paragraphs as any[])
    .filter((p: any) => {
      const from = (scene.sourceRange as { fromParagraph?: number } | null)?.fromParagraph ?? 0;
      const to = (scene.sourceRange as { toParagraph?: number } | null)?.toParagraph ?? 999;
      return (p.idx ?? 0) >= from && (p.idx ?? 0) <= to;
    })
    .map((p: any) => `[${p.idx}] ${p.text}`)
    .join("\n\n");

  const charNameField = useGemini ? `"characterNames": ["CHAR_1"]` : `"characterNames": ["ชื่อตัวละคร"]`;
  const speakerField = useGemini ? `"speakerName": "CHAR_1"` : `"speakerName": "ชื่อตัวละคร"`;

  const userPrompt = `
## Scene: ${scene.sceneCode}
TimeOfDay: ${scene.timeOfDay ?? ""} | Mood: ${scene.mood ?? ""} | Total duration: ${shortDrama ? sceneDurationSec : scene.estDurationSec ?? 30}s
${shortDrama ? `Beat: ${toPromptNames(scene.summary ?? "")}
Start frame: ${toPromptNames(scene.dramaBeat.entry ?? "")}
End frame: ${toPromptNames(scene.dramaBeat.exit ?? "")}
${dialoguePurpose ? `Dialogue required: ${toPromptNames(dialoguePurpose)}. Include a spoken line in the shot dialogue, with a visible approved speaker.` : ""}
${dialogueBudgetSec !== undefined ? `Dialogue budget: ${dialogueBudgetSec}s of natural speech in total.` : ""}
Previous scene closing shot: ${handoffText(previous)}
Next scene opening shot: ${handoffText(next)}
Opening camera angle: ${opening ?? "choose a clearly different angle from the previous closing shot"}
Closing camera angle: ${closing ?? "choose a clearly different angle from the next opening shot"}
cameraAngle values: ${DRAMA_CAMERA_ANGLES.join(", ")}. A front/three-quarter, three-quarter/profile, or high/overhead pair is too similar at a scene cut.
Render this scene as one clip. All shots must total exactly ${sceneDurationSec}s, with a clean handoff at the end of the scene.
Generate only this beat. Keep approved names and preserve the original spoken language; label shortened lines as generated.` : ""}

## Characters in this scene
${charContext || "(none)"}

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
      "shotType": "wide",
      "camera": "ขนาดภาพ มุมจริง และการเคลื่อนไหวกล้องภาษาไทย",${shortDrama ? '\n      "cameraAngle": "side-profile",' : ""}
      "durationSec": 4,${shortDrama ? '\n      "direction": { "blocking": "ตำแหน่ง/ทิศ/พร็อพ", "performance": "สีหน้า/แววตา/ภาษากาย", "cut": "ชนิด/จังหวะตัด", "backgroundActivity": "การเคลื่อนไหวฉากหลัง" },' : ""}
      "breakQuality": "hard",
      ${charNameField},
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
**Null rules:** sfx, music, camera, action, emotion ต้องเป็น string ใช้ "" แทน null
`.trim();

  const schema = shortDrama ? ShotListResult.superRefine(({ shots }, ctx) => {
    if (dialoguePurpose && !shots.some(shot => shot.dialogue.some(line => isSpokenLine(line.lineTh)))) {
      ctx.addIssue({ code: "custom", path: ["shots"], message:
        "This scene requires at least one real spoken line in dialogue with an approved visible speaker. Do not use narration or an ellipsis as a line." });
    }
    if (!fitsDramaScene(alignDramaShotTiming(shots, sceneDurationSec), sceneDurationSec)) {
      const returnedDuration = shotTimeline(shots).at(-1)?.end ?? 0;
      ctx.addIssue({ code: "custom", path: ["shots"], message:
        `Your shots total ${returnedDuration}s. Adjust the shot times to exactly ${sceneDurationSec}s in tenths, 0.5–4s silent or up to 7s with dialogue.` });
    }
    const first = shots[0].cameraAngle;
    const last = shots.at(-1)?.cameraAngle;
    if (!first || (opening && first !== opening) || (previous?.angle && !distinctDramaAngles(first, previous.angle))) {
      ctx.addIssue({ code: "custom", path: ["shots", 0, "cameraAngle"], message:
        `Use opening angle ${opening ?? "clearly different from the previous scene"}; the previous scene closes on ${previous?.angle ?? previous?.camera ?? "no prior camera"}.` });
    }
    if (!last || (closing && last !== closing) || (next?.angle && !distinctDramaAngles(last, next.angle))) {
      ctx.addIssue({ code: "custom", path: ["shots", shots.length - 1, "cameraAngle"], message:
        `Use closing angle ${closing ?? "clearly different from the next scene"}; the next scene opens on ${next?.angle ?? next?.camera ?? "no next camera"}.` });
    }
    let totalSpeech = 0;
    shots.forEach((shot, index) => {
      const visible = new Set(shot.characterNames.map(toCharacterName));
      if (!shot.direction || !shot.camera.trim() || !shot.cameraAngle || !shot.action.trim() ||
          [...visible].some(name => !charMap.has(name)) ||
          shot.dialogue.some(line => !visible.has(toCharacterName(line.speakerName)) || !isSpokenLine(line.lineTh) || !line.tone.trim())) {
        ctx.addIssue({ code: "custom", path: ["shots", index], message: "Supply camera, action and all direction fields. Dialogue needs one known visible speaker and an explicit vocal tone." });
      }
      const describedAngle = cameraAngleFromDirection(shot.camera);
      if (describedAngle && describedAngle !== shot.cameraAngle) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "camera"], message: "The camera description must show the same physical angle as cameraAngle." });
      }
      const speech = dramaSpeechSeconds(shot.dialogue.map(line => ({ lineTh: replaceChar(line.lineTh) })));
      totalSpeech += speech;
      if (shot.dialogue.length > 1 || speech > shot.durationSec) {
        ctx.addIssue({ code: "custom", path: ["shots", index, "dialogue"], message:
          `Write at most one brief line, keeping the punch or new information and cutting setup. This dialogue needs about ${speech.toFixed(1)}s for a ${shot.durationSec}s shot. Label shortened source dialogue generated.` });
      }
    });
    if (dialogueBudgetSec !== undefined && totalSpeech > dialogueBudgetSec) {
      ctx.addIssue({ code: "custom", path: ["shots"], message:
        `The dialogue takes about ${totalSpeech.toFixed(1)}s. Keep only the essential spoken beats and stay within the scene's ${dialogueBudgetSec}s speech budget.` });
    }
  }) : ShotListResult;
  const request = {
    system: loadPrompt(shortDrama ? "s3-short-drama.txt" : "s3-shots.txt"),
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
          ...(shortDrama && { cameraAngle: sh.cameraAngle }),
          durationSec: sh.durationSec,
          breakQuality: sh.breakQuality,
          characterIds,
          locationId: scene.locationId,
          action: replaceChar(sh.action),
          emotion: replaceChar(sh.emotion),
          direction: sh.direction && {
            blocking: replaceChar(sh.direction.blocking),
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
