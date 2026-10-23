import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { SceneBreakdownResult } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Job } from "../models/Job.js";
import { config } from "../config/index.js";

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

  const useGemini = config.llm.provider === "gemini";

  // Gemini: ใช้ CHAR_N/LOC_N แทนชื่อภาษาไทย | DeepSeek: ใช้ชื่อจริงตรงๆ
  const charIndexMap = new Map(characters.map((c, i) => [c.name as string, `CHAR_${i + 1}`]));
  const locIndexMap = new Map(locations.map((l, i) => [l.name as string, `LOC_${i + 1}`]));
  const charReverseMap = new Map(characters.map((c, i) => [`CHAR_${i + 1}`, c.name as string]));
  const locReverseMap = new Map(locations.map((l, i) => [`LOC_${i + 1}`, l.name as string]));

  const charList = useGemini
    ? characters.map((c, i) => `- CHAR_${i + 1} (${(c as any).role ?? "support"})`).join("\n")
    : characters.map((c) => `- ${c.name} (${(c as any).role ?? "support"})`).join("\n");

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

  const userPrompt = `
## Characters in Bible (${charNote})
${charList || "(none)"}

## Locations in Bible (${charNote})
${locList || "(none)"}

## Novel text EP ${episode.number}
${novelText}

## Return JSON:
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

  for (const s of data.scenes) {
    const sceneCode = `EP${String(episode.number).padStart(2, "0")}-S${String(s.order).padStart(2, "0")}`;

    // map LOC_N หรือชื่อจริง → ObjectId
    const locName = locReverseMap.get(s.locationId) ?? locReverseMap.get(s.locationName) ?? s.locationName ?? s.locationId;
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
