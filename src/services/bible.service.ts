import { Types } from "mongoose";
import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { BibleExtractionResult, type LLMCharacterType, type LLMLocationType } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Episode } from "../models/Episode.js";
import { Job } from "../models/Job.js";
import { decideMerge, mergeAliases, type BibleEntity } from "../utils/mergeLogic.js";

export async function runBibleExtraction(
  projectId: string,
  episodeId: string,
  jobId: string
): Promise<void> {
  const episode = await Episode.findById(episodeId).lean();
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  await Job.findByIdAndUpdate(jobId, { status: "running", progress: 0.1 });

  const existingChars = await Character.find({ projectId }).lean() as unknown as Array<BibleEntity & {
    personality?: string; age?: string; appearance?: Record<string, unknown>;
    outfits?: unknown[]; appearanceBlock?: string; characterSheetPrompt?: string; voice?: Record<string, unknown>;
  }>;
  const existingLocs = await Location.find({ projectId }).lean() as unknown as Array<BibleEntity & {
    description?: string; lighting?: string; mood?: string;
    locationBlock?: string; masterPrompt?: string; keyElements?: string[];
  }>;

  const bibleContext = buildBibleContext(
    existingChars.map((c) => ({ name: c.name, aliases: c.aliases, role: (c as unknown as { role?: string }).role ?? "support" })),
    existingLocs.map((l) => ({ name: l.name, aliases: l.aliases }))
  );
  const rawNovelText = episode.paragraphs.map((p) => `[${p.idx}] ${p.text}`).join("\n\n");
  const novelText = rawNovelText;

  const userPrompt = buildS1Prompt(episode.number, episode.title ?? "", bibleContext, novelText);

  await Job.findByIdAndUpdate(jobId, { progress: 0.3 });

  const { data, tokens } = await callStructured({
    system: loadPrompt("s1-bible.txt"),
    user: userPrompt,
    schema: BibleExtractionResult,
    temperature: 0.1,
  });

  await Job.findByIdAndUpdate(jobId, { progress: 0.6 });

  await mergeCharacters(projectId, episode.number, data.characters, existingChars);
  await mergeLocations(projectId, episode.number, data.locations, existingLocs);

  if (data.episodeSummary) {
    await Episode.findByIdAndUpdate(episodeId, {
      summary: data.episodeSummary,
      status: "bible_review",
    });
  }

  await Job.findByIdAndUpdate(jobId, {
    status: "succeeded",
    progress: 1,
    "tokens.in": tokens.in,
    "tokens.out": tokens.out,
    finishedAt: new Date(),
  });
}

// ---- Merge Characters ----

async function mergeCharacters(
  projectId: string,
  epNumber: number,
  incoming: LLMCharacterType[],
  existing: Array<BibleEntity & Record<string, unknown>>
): Promise<void> {
  for (const char of incoming) {
    const decision = decideMerge(char.name, char.aliases, existing);

    if (decision.action === "create") {
      const created = await Character.create({
        projectId,
        name: char.name,
        aliases: char.aliases,
        role: char.role,
        age: char.age,
        personality: char.personality,
        appearance: char.appearance,
        outfits: char.outfits,
        appearanceBlock: char.appearanceBlock,
        characterSheetPrompt: char.characterSheetPrompt,
        voice: char.voice,
        firstAppearanceEp: epNumber,
        episodes: [epNumber],
        needsReview: char.needsReview,
        status: "draft",
        version: 1,
      });
      // เพิ่มเข้า existing เพื่อให้ตัวถัดไปในรอบเดียวกันเห็น
      existing.push({ ...created.toObject(), _id: created._id } as unknown as typeof existing[0]);
    } else if (decision.action === "update") {
      const { targetId, isApproved } = decision;

      const addToSet: Record<string, unknown> = { episodes: epNumber };
      if (char.aliases.length > 0) {
        addToSet.aliases = { $each: char.aliases };
      }

      const update: Record<string, unknown> = {
        $addToSet: addToSet,
        $inc: { version: 1 },
      };

      // หา outfit ใหม่ที่ยังไม่มีใน existing (เทียบด้วยชื่อ)
      const existingChar = existing.find((e) => e._id.toString() === targetId.toString());
      const existingOutfitNames = new Set(
        ((existingChar as unknown as { outfits?: Array<{ name: string }> })?.outfits ?? []).map((o) => o.name.toLowerCase().trim())
      );
      const newOutfits = char.outfits.filter((o) => !existingOutfitNames.has(o.name.toLowerCase().trim()));
      const hasNewOutfit = newOutfits.length > 0;

      if (hasNewOutfit) {
        // เพิ่ม outfit ใหม่เข้า array และ flag needsReview
        addToSet.outfits = { $each: newOutfits.map((o) => ({
          name: o.name,
          description: o.description,
          outfitPrompt: o.outfitPrompt ?? "",
          outfitSheetPrompt: o.outfitSheetPrompt ?? "",
          usedInScenes: [],
        })) };
        update.$set = { needsReview: true };
      }

      if (!isApproved) {
        update.$set = {
          ...(update.$set as object ?? {}),
          personality: char.personality,
          age: char.age,
          appearance: char.appearance,
          appearanceBlock: char.appearanceBlock,
          characterSheetPrompt: char.characterSheetPrompt,
          voice: char.voice,
          needsReview: char.needsReview || hasNewOutfit,
        };
      } else if (char.needsReview || hasNewOutfit) {
        update.$set = { ...(update.$set as object ?? {}), needsReview: true };
      }

      await Character.findByIdAndUpdate(targetId, update);
    } else {
      // needs_review
      await Character.create({
        projectId,
        name: char.name,
        aliases: char.aliases,
        role: char.role,
        age: char.age,
        personality: char.personality,
        appearance: char.appearance,
        outfits: char.outfits,
        appearanceBlock: char.appearanceBlock,
        characterSheetPrompt: char.characterSheetPrompt,
        voice: char.voice,
        firstAppearanceEp: epNumber,
        episodes: [epNumber],
        needsReview: true,
        status: "draft",
        version: 1,
      }).catch(() => {
        // ถ้าชื่อซ้ำ (unique index) → update needsReview แทน
        return Character.findOneAndUpdate(
          { projectId, name: char.name },
          { $set: { needsReview: true }, $addToSet: { episodes: epNumber } }
        );
      });
    }
  }
}

// ---- Merge Locations ----

async function mergeLocations(
  projectId: string,
  epNumber: number,
  incoming: LLMLocationType[],
  existing: Array<BibleEntity & Record<string, unknown>>
): Promise<void> {
  for (const loc of incoming) {
    const decision = decideMerge(loc.name, loc.aliases, existing);

    if (decision.action === "create") {
      await Location.create({
        projectId,
        name: loc.name,
        aliases: loc.aliases,
        type: loc.type,
        description: loc.description,
        timeOfDay: loc.timeOfDay,
        lighting: loc.lighting,
        weather: loc.weather,
        materials: loc.materials,
        keyElements: loc.keyElements,
        mood: loc.mood,
        locationBlock: loc.locationBlock,
        masterPrompt: loc.masterPrompt,
        episodes: [epNumber],
        needsReview: loc.needsReview,
        status: "draft",
        version: 1,
      });
    } else if (decision.action === "update") {
      const { targetId, isApproved } = decision;

      const addToSet: Record<string, unknown> = { episodes: epNumber };
      if (loc.aliases.length > 0) {
        addToSet.aliases = { $each: loc.aliases };
      }

      const update: Record<string, unknown> = {
        $addToSet: addToSet,
        $inc: { version: 1 },
      };
      if (!isApproved) {
        update.$set = {
          description: loc.description,
          lighting: loc.lighting,
          mood: loc.mood,
          locationBlock: loc.locationBlock,
          masterPrompt: loc.masterPrompt,
          keyElements: loc.keyElements,
        };
      }
      await Location.findByIdAndUpdate(targetId, update);
    } else {
      await Location.findOneAndUpdate(
        { projectId, name: loc.name },
        { $set: { needsReview: true }, $addToSet: { episodes: epNumber } },
        { upsert: true }
      );
    }
  }
}

// ---- Helpers ----

function buildBibleContext(
  chars: Array<{ name: string; aliases: string[]; role: string }>,
  locs: Array<{ name: string; aliases: string[] }>
): string {
  if (chars.length === 0 && locs.length === 0) return "(ยังไม่มี Bible)";
  const charList = chars.map((c) => `- ${c.name} (${c.role}) aliases: [${c.aliases.join(", ")}]`).join("\n");
  const locList = locs.map((l) => `- ${l.name} aliases: [${l.aliases.join(", ")}]`).join("\n");
  return `ตัวละคร:\n${charList || "(ไม่มี)"}\n\nสถานที่:\n${locList || "(ไม่มี)"}`;
}

function buildS1Prompt(epNumber: number, title: string, bibleContext: string, novelText: string): string {
  return `
## Bible ที่มีอยู่แล้ว
${bibleContext}

## ข้อความนิยาย EP ${epNumber}: ${title}
${novelText}

## Schema ที่ต้องคืน
\`\`\`json
{
  "characters": [ { "name": "ชื่อตัวละคร", "aliases": [], "role": "main", "age": "", "personality": "", "appearance": { "hair": "", "skin": "", "eyes": "", "build": "", "distinguishing": "", "defaultOutfit": "", "inferredFields": [] }, "outfits": [{ "name": "ชื่อชุด", "description": "บรรยายชุดภาษาไทย", "outfitPrompt": "character appearance wearing outfit details in English", "outfitSheetPrompt": "anime character sheet, multiple views, front/side/back, character appearance wearing outfit, white background, reference sheet style, full body" }], "voice": { "gender": "", "ageRange": "", "pitch": "", "timbre": "", "pace": "", "accent": "", "defaultEmotion": "", "speechHabits": [], "sampleLines": [] }, "appearanceBlock": "appearance without outfit in English", "characterSheetPrompt": "full character sheet prompt in English", "voicePrompt": "", "needsReview": false, "needsReviewReason": "" } ],
  "locations": [ { "name": "ชื่อสถานที่", "aliases": [], "type": "interior", "description": "", "timeOfDay": "", "lighting": "", "weather": "", "materials": "", "keyElements": [], "mood": "", "locationBlock": "", "masterPrompt": "", "relatedCharacterNames": [], "needsReview": false } ],
  "episodeSummary": "สรุปเหตุการณ์ใน EP นี้ 2-3 ประโยค"
}
\`\`\`

**กฎ enum ที่ต้องเลือกค่าใดค่าหนึ่งเท่านั้น:**
- role: "main" หรือ "support" หรือ "extra"
- type (location): "interior" หรือ "exterior"
`.trim();
}
