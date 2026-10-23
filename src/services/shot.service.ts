import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { ShotListResult } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Job } from "../models/Job.js";
import { queues } from "../queues/jobRunner.js";

type SceneLean = Record<string, any>;
type EpisodeLean = Record<string, any>;
type CharLean = Record<string, any>;

// ---- core: สร้าง shots สำหรับ 1 scene ----
export async function buildShotsForScene(
  scene: SceneLean,
  episode: EpisodeLean,
  characters: CharLean[],
  prevSummary: string
): Promise<{ sceneSummary: string; tokensIn: number; tokensOut: number }> {
  const charMap = new Map(characters.map((c) => [c.name, c]));

  const sceneText = (episode.paragraphs as any[])
    .filter((p: any) => {
      const from = (scene.sourceRange as { fromParagraph?: number } | null)?.fromParagraph ?? 0;
      const to = (scene.sourceRange as { toParagraph?: number } | null)?.toParagraph ?? 999;
      return (p.idx ?? 0) >= from && (p.idx ?? 0) <= to;
    })
    .map((p: any) => `[${p.idx}] ${p.text}`)
    .join("\n\n");

  const charContext = characters
    .filter((c) => (scene.characterIds as unknown[])?.some((id) => id?.toString() === c._id?.toString()))
    .map((c) => `- ${c.name}: ${c.personality ?? ""} | speechHabits: [${(c.voice?.speechHabits ?? []).join(", ")}]`)
    .join("\n");

  // แปล sceneText เป็น English ก่อนส่ง Gemini เพื่อหลีกเลี่ยง PROHIBITED_CONTENT
  let translatedSceneText = sceneText;

  const userPrompt = `
## Scene: ${scene.sceneCode} — ${scene.title}
สถานที่: ${scene.timeOfDay ?? ""} | อารมณ์: ${scene.mood ?? ""} | **เวลาทั้งหมด: ${scene.estDurationSec ?? 30} วินาที (ควรได้ประมาณ ${Math.round(Number(scene.estDurationSec ?? 30) / 5)} shots)**

## ตัวละครในฉากนี้
${charContext || "(ไม่มี)"}

## สรุปเหตุการณ์ก่อนหน้า
${prevSummary || "(เริ่มต้น EP)"}

## ข้อความต้นฉบับ
${translatedSceneText}

## Schema ที่ต้องคืน
\`\`\`json
{
  "shots": [
    {
      "order": 1,
      "shotType": "wide",
      "camera": "กล้องเคลื่อนไหวอย่างไร",
      "durationSec": 4,
      "breakQuality": "hard",
      "characterNames": ["ชื่อจาก Bible"],
      "action": "การกระทำ",
      "emotion": "อารมณ์",
      "dialogue": [{ "speakerName": "ชื่อ", "lineTh": "บทพูด", "tone": "น้ำเสียง", "source": "original" }],
      "narration": null,
      "sfx": "",
      "music": ""
    }
  ],
  "sceneSummary": "สรุปสิ่งที่เกิดขึ้นใน scene นี้ 1-2 ประโยค"
}
\`\`\`

**กฎ enum:** shotType ต้องเป็นค่าใดค่าหนึ่ง: wide, medium, close-up, OTS, insert, POV — breakQuality: hard, soft, avoid — source: original, generated
**กฎ null:** sfx, music, camera, action, emotion ต้องเป็น string เสมอ ห้ามเป็น null ให้ใช้ "" แทน
`.trim();

  const { data, tokens } = await callStructured({
    system: loadPrompt("s3-shots.txt"),
    user: userPrompt,
    schema: ShotListResult,
    temperature: 0.3,
    maxTokens: 16000,
  });

  const epPrefix = `EP${String(episode.number).padStart(2, "0")}`;
  const sceneNum = String(scene.order).padStart(2, "0");
  const episodeId = scene.episodeId;

  for (const sh of data.shots) {
    const shotCode = `${epPrefix}-S${sceneNum}-SH${String(sh.order).padStart(2, "0")}`;
    const characterIds = sh.characterNames.map((n) => charMap.get(n)?._id).filter(Boolean);
    const dialogue = sh.dialogue.map((d) => ({
      speakerId: charMap.get(d.speakerName)?._id,
      lineTh: d.lineTh,
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
          camera: sh.camera,
          durationSec: sh.durationSec,
          breakQuality: sh.breakQuality,
          characterIds,
          locationId: scene.locationId,
          action: sh.action,
          emotion: sh.emotion,
          dialogue,
          narration: sh.narration,
          sfx: sh.sfx,
          music: sh.music,
        },
      },
      { upsert: true, new: true }
    );
  }

  const totalDur = data.shots.reduce((s, sh) => s + sh.durationSec, 0);
  await Scene.findByIdAndUpdate(scene._id, {
    shotCount: data.shots.length,
    totalDurationSec: totalDur,
  });

  return { sceneSummary: data.sceneSummary || prevSummary, tokensIn: tokens.in, tokensOut: tokens.out };
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

  await Job.findByIdAndUpdate(jobId, { status: "running", progress: 0.05 });

  const characters = await Character.find({ projectId, status: "approved" }).lean();

  let prevSummary = episode.summary ?? "";
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  await Promise.all(
    scenes.map((scene) =>
      queues.llm.add(async () => {
        const result = await buildShotsForScene(
          scene as unknown as SceneLean,
          episode as typeof episode & { summary?: string },
          characters,
          prevSummary
        );
        totalTokensIn += result.tokensIn;
        totalTokensOut += result.tokensOut;
        prevSummary = result.sceneSummary;
      })
    )
  );

  await Episode.findByIdAndUpdate(episodeId, { status: "shots_review" });
  await Job.findByIdAndUpdate(jobId, {
    status: "succeeded",
    progress: 1,
    "tokens.in": totalTokensIn,
    "tokens.out": totalTokensOut,
    finishedAt: new Date(),
  });
}
