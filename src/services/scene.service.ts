import type { Types } from "mongoose";
import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { SceneBreakdownResult } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Job } from "../models/Job.js";
import { Project } from "../models/Project.js";
import { DRAMA_EP_SECONDS, DRAMA_MIN_CLIP_SECONDS, DRAMA_MAX_CLIP_SECONDS, isDramaClipDuration, minimumDramaSceneCount } from "../utils/shortDrama.js";
import { config } from "../config/index.js";
import { DRAMA_CAMERA_ANGLES, distinctDramaAngles } from "../utils/dramaCamera.js";

function replaceIndexes(text: string, charMap: Map<string, string>, locMap: Map<string, string>): string {
  return text.replace(/(?:CHAR|LOC)_\d+/g, token => charMap.get(token) ?? locMap.get(token) ?? token);
}

export async function runSceneBreakdown(
  projectId: string,
  episodeId: string,
  jobId: string
): Promise<void> {
  const episode = await Episode.findById(episodeId).lean();
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  await Job.findByIdAndUpdate(jobId, { status: "running", progress: 0.1, statusMessage: "โหลดข้อมูล Bible…" });

  const characters = await Character.find({ projectId, status: "approved" })
    .select("name role outfits.name")
    .lean<Array<{ _id: Types.ObjectId; name: string; role: string; outfits?: { name: string }[] }>>();
  const locations = await Location.find({ projectId, status: "approved" }).lean();
  const project = await Project.findById(projectId).lean();
  const configuredDuration = episode.targetDurationSec ?? project?.targetEpDurationSec ?? DRAMA_EP_SECONDS;
  const shortDrama = (project?.videoModel?.name ?? project?.styleGuide?.targetVideoModel ?? "minimax-h3") === "minimax-h3";
  const targetEpDurationSec = shortDrama ? Math.round(configuredDuration) : configuredDuration;
  if (shortDrama && targetEpDurationSec < DRAMA_MIN_CLIP_SECONDS) {
    throw new Error(`เวลารวมของตอนต้องอย่างน้อย ${DRAMA_MIN_CLIP_SECONDS} วินาทีสำหรับ MiniMax H3`);
  }

  const useGemini = config.llm.provider === "gemini";

  // Gemini: ใช้ CHAR_N/LOC_N แทนชื่อภาษาไทย | DeepSeek: ใช้ชื่อจริงตรงๆ
  const charIndexMap = new Map(characters.map((c, i) => [c.name as string, `CHAR_${i + 1}`]));
  const locIndexMap = new Map(locations.map((l, i) => [l.name as string, `LOC_${i + 1}`]));
  const charReverseMap = new Map(characters.map((c, i) => [`CHAR_${i + 1}`, c.name as string]));
  const locReverseMap = new Map(locations.map((l, i) => [`LOC_${i + 1}`, l.name as string]));

  const charList = characters.map((c, i) => {
    const label = useGemini ? `CHAR_${i + 1}` : c.name;
    const wardrobe = shortDrama && c.outfits?.length ? ` | wardrobe: ${c.outfits.map(o => o.name).join(", ")}` : "";
    return `- ${label} (${c.role})${wardrobe}`;
  }).join("\n");

  const locList = useGemini
    ? locations.map((l, i) => `- LOC_${i + 1}`).join("\n")
    : locations.map((l) => `- ${l.name}`).join("\n");

  let novelText = episode.paragraphs.map((p) => `[${p.idx}] ${p.text}`).join("\n\n");
  if (useGemini) {
    for (const [name, idx] of charIndexMap) novelText = novelText.split(name).join(idx);
    for (const [name, idx] of locIndexMap) novelText = novelText.split(name).join(idx);
  }

  const locationField = useGemini ? `"locationId": "LOC_1"` : `"locationName": "ชื่อสถานที่จาก Bible"`;
  const charField = useGemini ? `"characterIds": ["CHAR_1", "CHAR_2"]` : `"characterNames": ["ชื่อตัวละคร"]`;
  const charNote = useGemini ? "use CHAR_N/LOC_N IDs only" : "ใช้ชื่อจริงจาก Bible";
  const minimumScenes = minimumDramaSceneCount(targetEpDurationSec);

  const userPrompt = `
## Target EP duration
${shortDrama
  ? `${targetEpDurationSec} วินาทีพอดี คำนวณได้อย่างน้อย ${minimumScenes} ซีน เลือกจำนวนจริงตามเนื้อเรื่อง หนึ่งซีนสร้างหนึ่งคลิป ให้ estDurationSec ของทุกซีนเป็นจำนวนเต็ม ${DRAMA_MIN_CLIP_SECONDS}–${DRAMA_MAX_CLIP_SECONDS} วินาที และผลรวมตรงกับเวลาของตอน ส่ง entry, exit, openingAngle, closingAngle และ dialogueBudgetSec ทุกซีน มุมใช้ ${DRAMA_CAMERA_ANGLES.join(", ")} พร้อม supportingLocations สำหรับสถานที่รองที่เห็นจากสถานที่หลัก และ wardrobe โดยใช้ชื่อชุดจากรายการเมื่อกำหนดได้`
  : `อย่างน้อย ${targetEpDurationSec} วินาที — รวม estDurationSec ทุก scene ต้องได้ถึงเป้าหมายนี้`}
${project?.genre ? `
## Drama genre
${JSON.stringify(project.genre)} — ใช้กำกับอารมณ์และจังหวะของซีนตามเหตุการณ์ในต้นฉบับ` : ""}

## Characters in Bible (${charNote})
${charList || "(none)"}

## Locations in Bible (${charNote})
${locList || "(none)"}

## Novel text EP ${episode.number}
${novelText}

## Return JSON (ตัวอย่างโครงสร้างของหนึ่งรายการ):
\`\`\`json
{
  "scenes": [
    {
      "order": 1,
      "title": "ชื่อฉากภาษาไทย",
      "summary": "สรุปสั้นๆ ภาษาไทย",
      ${locationField},
      "timeOfDay": "เช้า|กลางวัน|เย็น|กลางคืน",
      "mood": "อารมณ์ของฉาก",
      ${charField},
      "fromParagraph": 0,
      "toParagraph": 5,
      "estDurationSec": ${shortDrama ? 12 : 45}${shortDrama ? ', "entry": "สภาพเปิด", "exit": "สภาพจบ", "openingAngle": "side-profile", "closingAngle": "frontal", "dialoguePurpose": "ข้อมูลหรือการตัดสินใจเดียวที่คำพูดขยับ หรือสตริงว่างสำหรับซีนภาพล้วน", "dialogueBudgetSec": 3, "supportingLocations": [], "wardrobe": {}' : ""}
    }
  ]
}
\`\`\`
`.trim();

  await Job.findByIdAndUpdate(jobId, { progress: 0.3, statusMessage: "AI กำลังวิเคราะห์และแบ่งฉาก…" });

  const locMap = new Map(locations.map((l) => [l.name, l._id]));
  const charMap = new Map(characters.map((c) => [c.name, c._id]));
  const outfitNames = new Map(characters.map(c => [c.name, new Set((c.outfits ?? []).map(o => o.name))]));
  const paragraphIds = new Set(episode.paragraphs.map(p => p.idx));
  const schema = shortDrama ? SceneBreakdownResult.superRefine(({ scenes }, ctx) => {
    if (!scenes.some(scene => scene.dialoguePurpose)) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message:
        "Plan meaningful spoken dialogue in at least one scene. Set dialoguePurpose for that scene and include its speaker in the approved cast." });
    }
    if (scenes.length < minimumScenes || scenes.some(scene => !isDramaClipDuration(scene.estDurationSec))) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message:
        `For a ${targetEpDurationSec}s episode, return at least ${minimumScenes} scenes, each ${DRAMA_MIN_CLIP_SECONDS}–${DRAMA_MAX_CLIP_SECONDS} whole seconds. Split longer beats into consecutive scenes.` });
    }
    const duration = scenes.reduce((sum, scene) => sum + scene.estDurationSec, 0);
    if (duration !== targetEpDurationSec) {
      ctx.addIssue({ code: "custom", path: ["scenes"], message:
        `The scene durations total ${duration} seconds. Adjust the scene budgets to total exactly ${targetEpDurationSec} seconds.` });
    }
    scenes.forEach((scene, index) => {
      const previous = scenes[index - 1];
      if (!scene.openingAngle || !scene.closingAngle ||
          (previous?.closingAngle && !distinctDramaAngles(previous.closingAngle, scene.openingAngle))) {
        ctx.addIssue({ code: "custom", path: ["scenes", index, "openingAngle"], message:
          `Supply openingAngle and closingAngle. The opener must clearly differ from the previous closer (${previous?.closingAngle ?? "none"}). A closer crop, new lens or slight pivot is the same setup.` });
      }
      const budget = scene.dialogueBudgetSec;
      if (budget === undefined || (scene.dialoguePurpose ? budget < 1 || budget > scene.estDurationSec : budget !== 0)) {
        ctx.addIssue({ code: "custom", path: ["scenes", index, "dialogueBudgetSec"], message:
          "Budget only the seconds needed for the essential spoken beat, from 1s to the scene duration, or 0 for a silent scene." });
      }
      const locRef = scene.locationId || scene.locationName;
      const charRefs = scene.characterIds.length ? scene.characterIds : scene.characterNames;
      if (scene.dialoguePurpose && !charRefs.length) {
        ctx.addIssue({ code: "custom", path: ["scenes", index, "dialoguePurpose"], message:
          "A scene with spoken dialogue needs at least one character in its cast." });
      }
      if (scene.order !== index + 1 || !scene.entry || !scene.exit ||
          !locMap.has(locReverseMap.get(locRef) ?? locRef) ||
          charRefs.some(ref => !charMap.has(charReverseMap.get(ref) ?? ref)) ||
          scene.supportingLocations.some(ref => !locMap.has(locReverseMap.get(ref) ?? ref)) ||
          Object.entries(scene.wardrobe).some(([ref, outfit]) => {
            const name = charReverseMap.get(ref) ?? ref;
            return !charRefs.some(char => (charReverseMap.get(char) ?? char) === name) || !outfitNames.get(name)?.has(outfit);
          }) ||
          new Set(charRefs).size + new Set([locRef, ...scene.supportingLocations]).size > (project?.videoModel?.maxRefImages ?? 9) ||
          !paragraphIds.has(scene.fromParagraph) || !paragraphIds.has(scene.toParagraph) ||
          scene.fromParagraph > scene.toParagraph) {
        ctx.addIssue({ code: "custom", path: ["scenes", index], message: "Check scene order, entry/exit, Bible references and original paragraph indexes." });
      }
    });
  }) : SceneBreakdownResult;
  const { data, tokens } = await callStructured({
    system: loadPrompt(shortDrama ? "s2-short-drama.txt" : "s2-scenes.txt"),
    user: userPrompt,
    schema,
    temperature: 0.1,
    maxTokens: 32000,
  });

  await Job.findByIdAndUpdate(jobId, { progress: 0.6, statusMessage: `บันทึก ${data.scenes.length} ฉากลงฐานข้อมูล…`, "tokens.in": tokens.in, "tokens.out": tokens.out });

  // enforce minimum EP duration — scale up estDurationSec ถ้ารวมไม่ถึง target
  const totalEst = data.scenes.reduce((s, sc) => s + sc.estDurationSec, 0);
  if (!shortDrama && totalEst < targetEpDurationSec) {
    const scale = targetEpDurationSec / totalEst;
    data.scenes.forEach(sc => {
      sc.estDurationSec = Math.round(sc.estDurationSec * scale);
    });
  }

  // reset S2/S3/S4 ของ EP นี้ก่อนสร้างใหม่
  const oldScenes = await Scene.find({ episodeId }).select("_id").lean();
  const oldSceneIds = oldScenes.map(s => s._id);
  if (oldSceneIds.length > 0) {
    await Shot.deleteMany({ sceneId: { $in: oldSceneIds } });
  }
  await Scene.deleteMany({ episodeId });

  for (const s of data.scenes) {
    const sceneCode = `EP${String(episode.number).padStart(2, "0")}-S${String(s.order).padStart(2, "0")}`;

    // map LOC_N หรือชื่อจริง → ObjectId
    const locRef = s.locationId || s.locationName;
    const locName = locReverseMap.get(locRef) ?? locRef;
    const locationId = locMap.get(locName);

    // map CHAR_N หรือชื่อจริง → ObjectId
    const rawCharRefs = s.characterIds.length > 0 ? s.characterIds : s.characterNames;
    const characterIds = rawCharRefs
      .map(ref => charMap.get(charReverseMap.get(ref) ?? ref))
      .filter(Boolean);

    await Scene.create({
      projectId,
      episodeId,
      order: s.order,
      sceneCode,
      title: useGemini ? replaceIndexes(s.title, charReverseMap, locReverseMap) : s.title,
      summary: useGemini ? replaceIndexes(s.summary, charReverseMap, locReverseMap) : s.summary,
      locationId,
      timeOfDay: s.timeOfDay,
      mood: s.mood,
      characterIds: [...new Set(characterIds)],
      sourceRange: { fromParagraph: s.fromParagraph, toParagraph: s.toParagraph },
      estDurationSec: s.estDurationSec,
      dramaBeat: shortDrama ? {
        entry: replaceIndexes(s.entry, charReverseMap, locReverseMap),
        exit: replaceIndexes(s.exit, charReverseMap, locReverseMap),
        dialoguePurpose: replaceIndexes(s.dialoguePurpose, charReverseMap, locReverseMap),
        dialogueBudgetSec: s.dialogueBudgetSec,
        openingAngle: s.openingAngle,
        closingAngle: s.closingAngle,
        clipDurationsSec: [s.estDurationSec],
        supportingLocationIds: [...new Set(s.supportingLocations.map(ref => locReverseMap.get(ref) ?? ref))]
          .filter(name => name !== locName).map(name => locMap.get(name)),
        wardrobe: Object.entries(s.wardrobe).map(([ref, outfit]) => ({
          characterId: charMap.get(charReverseMap.get(ref) ?? ref),
          outfit,
        })),
      } : undefined,
      status: "draft",
      clips: [],
      videoPromptDraft: null,
    });
  }

  await Episode.findByIdAndUpdate(episodeId, { status: "scenes_review" });
  await Job.findByIdAndUpdate(jobId, {
    status: "succeeded",
    progress: 1,
    "tokens.in": tokens.in,
    "tokens.out": tokens.out,
    finishedAt: new Date(),
  });
}
