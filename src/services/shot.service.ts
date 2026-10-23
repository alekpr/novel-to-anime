import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { ShotListResult } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Job } from "../models/Job.js";
import { queues } from "../queues/jobRunner.js";
import { config } from "../config/index.js";

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
  const useGemini = config.llm.provider === "gemini";

  const sceneChars = characters.filter((c) =>
    (scene.characterIds as unknown[])?.some((id) => id?.toString() === c._id?.toString())
  );

  // Gemini: ใช้ CHAR_N | DeepSeek: ใช้ชื่อจริง
  const charIndexMap = new Map(sceneChars.map((c, i) => [c.name as string, `CHAR_${i + 1}`]));
  const charReverseMap = new Map(sceneChars.map((c, i) => [`CHAR_${i + 1}`, c.name as string]));

  const charContext = useGemini
    ? sceneChars.map((c, i) => `- CHAR_${i + 1} (${c.personality ?? ""}) | speechHabits: [${(c.voice?.speechHabits ?? []).join(", ")}]`).join("\n")
    : sceneChars.map((c) => `- ${c.name} (${c.personality ?? ""}) | speechHabits: [${(c.voice?.speechHabits ?? []).join(", ")}]`).join("\n");

  let sceneText = (episode.paragraphs as any[])
    .filter((p: any) => {
      const from = (scene.sourceRange as { fromParagraph?: number } | null)?.fromParagraph ?? 0;
      const to = (scene.sourceRange as { toParagraph?: number } | null)?.toParagraph ?? 999;
      return (p.idx ?? 0) >= from && (p.idx ?? 0) <= to;
    })
    .map((p: any) => `[${p.idx}] ${p.text}`)
    .join("\n\n");

  if (useGemini) {
    for (const [name, idx] of charIndexMap) sceneText = sceneText.split(name).join(idx);
  }

  const charNameField = useGemini ? `"characterNames": ["CHAR_1"]` : `"characterNames": ["ชื่อตัวละคร"]`;
  const speakerField = useGemini ? `"speakerName": "CHAR_1"` : `"speakerName": "ชื่อตัวละคร"`;

  const userPrompt = `
## Scene: ${scene.sceneCode}
TimeOfDay: ${scene.timeOfDay ?? ""} | Mood: ${scene.mood ?? ""} | Total duration: ${scene.estDurationSec ?? 30}s (~${Math.round(Number(scene.estDurationSec ?? 30) / 5)} shots)

## Characters in this scene
${charContext || "(none)"}

## Previous summary
${prevSummary || "(start of EP)"}

## Scene text
${sceneText}

## Return JSON:
\`\`\`json
{
  "shots": [
    {
      "order": 1,
      "shotType": "wide",
      "camera": "บรรยายการเคลื่อนไหวกล้องภาษาไทย",
      "durationSec": 4,
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

    // map ชื่อ/CHAR_N → ObjectId
    const characterIds = sh.characterNames
      .map(ref => charMap.get(charReverseMap.get(ref) ?? ref)?._id)
      .filter(Boolean);

    // replace CHAR_N ที่อาจค้างอยู่ใน text fields (Gemini เท่านั้น)
    const replaceChar = (text: string) => {
      if (!useGemini) return text;
      let result = text;
      for (const [idx, name] of charReverseMap) result = result.split(idx).join(name);
      return result;
    };

    const dialogue = sh.dialogue.map((d) => ({
      speakerId: charMap.get(charReverseMap.get(d.speakerName) ?? d.speakerName)?._id,
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
          durationSec: sh.durationSec,
          breakQuality: sh.breakQuality,
          characterIds,
          locationId: scene.locationId,
          action: replaceChar(sh.action),
          emotion: replaceChar(sh.emotion),
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
