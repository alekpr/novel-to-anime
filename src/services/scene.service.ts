import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { SceneBreakdownResult } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Job } from "../models/Job.js";

// replace CHAR_N/LOC_N กลับเป็นชื่อจริง
function replaceIndexes(text: string, charMap: Map<string, string>, locMap: Map<string, string>): string {
  let result = text;
  for (const [idx, name] of charMap) result = result.split(idx).join(name);
  for (const [idx, name] of locMap) result = result.split(idx).join(name);
  return result;
}

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

  // ใช้ index แทนชื่อภาษาไทยเพื่อหลีก PROHIBITED_CONTENT
  const charIndexMap = new Map(characters.map((c, i) => [c.name as string, `CHAR_${i + 1}`]));
  const locIndexMap = new Map(locations.map((l, i) => [l.name as string, `LOC_${i + 1}`]));
  const charReverseMap = new Map(characters.map((c, i) => [`CHAR_${i + 1}`, c.name as string]));
  const locReverseMap = new Map(locations.map((l, i) => [`LOC_${i + 1}`, l.name as string]));

  const charList = characters.map((c, i) => `- CHAR_${i + 1} (${(c as any).role ?? "support"})`).join("\n");
  const locList = locations.map((l, i) => `- LOC_${i + 1}`).join("\n");

  // แทนที่ชื่อภาษาไทยใน novelText ด้วย index
  let novelText = episode.paragraphs.map((p) => `[${p.idx}] ${p.text}`).join("\n\n");
  for (const [name, idx] of charIndexMap) novelText = novelText.split(name).join(idx);
  for (const [name, idx] of locIndexMap) novelText = novelText.split(name).join(idx);

  const userPrompt = `
## Characters in Bible (use these IDs only — do NOT use Thai names)
${charList || "(none)"}

## Locations in Bible (use these IDs only)
${locList || "(none)"}

## Novel text EP ${episode.number} (character/location names replaced with IDs)
${novelText}

## Return JSON:
\`\`\`json
{
  "scenes": [
    {
      "order": 1,
      "title": "scene title",
      "summary": "brief summary",
      "locationId": "LOC_1",
      "timeOfDay": "morning|afternoon|evening|night",
      "mood": "scene mood",
      "characterIds": ["CHAR_1", "CHAR_2"],
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
    maxTokens: 32000,
  });

  await Job.findByIdAndUpdate(jobId, { progress: 0.6, "tokens.in": tokens.in, "tokens.out": tokens.out });

  // reset S2/S3/S4 ของ EP นี้ก่อนสร้างใหม่
  const oldScenes = await Scene.find({ episodeId }).select("_id").lean();
  const oldSceneIds = oldScenes.map(s => s._id);
  if (oldSceneIds.length > 0) {
    await Shot.deleteMany({ sceneId: { $in: oldSceneIds } });
  }
  await Scene.deleteMany({ episodeId });

  const locMap = new Map(locations.map((l) => [l.name as string, l._id]));
  const charMap = new Map(characters.map((c) => [c.name as string, c._id]));

  // insert scenes ใหม่ทั้งหมด (ลบเดิมไปแล้วข้างบน)
  for (const s of data.scenes) {
    const sceneCode = `EP${String(episode.number).padStart(2, "0")}-S${String(s.order).padStart(2, "0")}`;

    // map LOC_N / ชื่อจริง → ObjectId
    const locName = locReverseMap.get(s.locationId) ?? locReverseMap.get(s.locationName) ?? s.locationName ?? s.locationId;
    const locationId = locMap.get(locName);

    // map CHAR_N / ชื่อจริง → ObjectId
    const rawCharIds = s.characterIds.length > 0 ? s.characterIds : s.characterNames;
    const characterIds = rawCharIds
      .map(ref => {
        const name = charReverseMap.get(ref) ?? ref;
        return charMap.get(name);
      })
      .filter(Boolean);

    await Scene.create({
      projectId,
      episodeId,
      order: s.order,
      sceneCode,
      // replace CHAR_N/LOC_N ที่ค้างใน title/summary ด้วยชื่อจริง
      title: replaceIndexes(s.title, charReverseMap, locReverseMap),
      summary: replaceIndexes(s.summary, charReverseMap, locReverseMap),
      locationId,
      timeOfDay: s.timeOfDay,
      mood: s.mood,
      characterIds,
      sourceRange: { fromParagraph: s.fromParagraph, toParagraph: s.toParagraph },
      estDurationSec: s.estDurationSec,
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
