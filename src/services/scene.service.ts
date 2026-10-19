import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { SceneBreakdownResult } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Job } from "../models/Job.js";

export async function runSceneBreakdown(
  projectId: string,
  episodeId: string,
  jobId: string
): Promise<void> {
  const episode = await Episode.findById(episodeId).lean();
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  await Job.findByIdAndUpdate(jobId, { status: "running", progress: 0.1 });

  const characters = await Character.find({ projectId, status: "approved" }).lean();
  const locations = await Location.find({ projectId, status: "approved" }).lean();

  const charList = characters.map((c) => `- ${c.name}`).join("\n");
  const locList = locations.map((l) => `- ${l.name}`).join("\n");
  const novelText = episode.paragraphs.map((p) => `[${p.idx}] ${p.text}`).join("\n\n");

  const userPrompt = `
## ตัวละครใน Bible (เลือกจากรายการนี้เท่านั้น)
${charList || "(ไม่มี)"}

## สถานที่ใน Bible (เลือกจากรายการนี้เท่านั้น)
${locList || "(ไม่มี)"}

## ข้อความนิยาย EP ${episode.number}
${novelText}

## Schema ที่ต้องคืน
\`\`\`json
{
  "scenes": [
    {
      "order": 1,
      "title": "ชื่อฉาก",
      "summary": "สรุปสั้นๆ",
      "locationName": "ชื่อสถานที่จาก Bible",
      "timeOfDay": "กลางวัน|กลางคืน|เช้า|เย็น|...",
      "mood": "อารมณ์ของฉาก",
      "characterNames": ["ชื่อจาก Bible"],
      "fromParagraph": 0,
      "toParagraph": 5,
      "estDurationSec": 45
    }
  ]
}
\`\`\`
`.trim();

  await Job.findByIdAndUpdate(jobId, { progress: 0.3 });

  const { data, tokens } = await callStructured({
    system: loadPrompt("s2-scenes.txt"),
    user: userPrompt,
    schema: SceneBreakdownResult,
    temperature: 0.1,
  });

  await Job.findByIdAndUpdate(jobId, { progress: 0.6, "tokens.in": tokens.in, "tokens.out": tokens.out });

  // สร้าง scene lookup maps
  const locMap = new Map(locations.map((l) => [l.name, l._id]));
  const charMap = new Map(characters.map((c) => [c.name, c._id]));

  // upsert scenes (idempotent ตาม sceneCode)
  for (const s of data.scenes) {
    const sceneCode = `EP${String(episode.number).padStart(2, "0")}-S${String(s.order).padStart(2, "0")}`;
    const locationId = locMap.get(s.locationName);
    const characterIds = s.characterNames
      .map((n) => charMap.get(n))
      .filter(Boolean);

    await Scene.findOneAndUpdate(
      { episodeId, sceneCode },
      {
        $set: {
          projectId,
          episodeId,
          order: s.order,
          sceneCode,
          title: s.title,
          summary: s.summary,
          locationId,
          timeOfDay: s.timeOfDay,
          mood: s.mood,
          characterIds,
          sourceRange: { fromParagraph: s.fromParagraph, toParagraph: s.toParagraph },
          estDurationSec: s.estDurationSec,
          status: "draft",
        },
      },
      { upsert: true, new: true }
    );
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
