import { Types } from "mongoose";
import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { BibleExtractionResult, type LLMCharacterType, type LLMLocationType, type LLMPropObjectType } from "../schemas/llm.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { PropObject } from "../models/PropObject.js";
import { Episode } from "../models/Episode.js";
import { Job } from "../models/Job.js";
import { Project } from "../models/Project.js";
import { decideMerge, mergeAliases, type BibleEntity } from "../utils/mergeLogic.js";

export async function runBibleExtraction(
  projectId: string,
  episodeId: string,
  jobId: string
): Promise<void> {
  const episode = await Episode.findById(episodeId).lean();
  if (!episode) throw new Error(`Episode ${episodeId} not found`);

  await Job.findByIdAndUpdate(jobId, { status: "running", progress: 0.1, statusMessage: "โหลดข้อมูลตัวละครและสถานที่ที่มีอยู่แล้วอยู่…" });

  const existingChars = await Character.find({ projectId }).lean() as unknown as Array<BibleEntity & {
    personality?: string; age?: string; appearance?: Record<string, unknown>;
    outfits?: Array<{ name: string }>; appearanceBlock?: string; characterSheetPrompt?: string; voice?: Record<string, unknown>;
  }>;
  const existingLocs = await Location.find({ projectId }).lean() as unknown as Array<BibleEntity & {
    description?: string; lighting?: string; mood?: string;
    locationBlock?: string; masterPrompt?: string; keyElements?: string[];
  }>;
  const project = await Project.findById(projectId).lean() as unknown as {
    factions?: Array<{ name: string; description: string; costumeDescription: string; costumePrompt: string }>
  } | null;
  const existingFactions = project?.factions ?? [];

  const existingProps = await PropObject.find({ projectId }, { name: 1, aliases: 1 }).lean() as unknown as Array<{ name: string; aliases: string[] }>;

  const bibleContext = buildBibleContext(
    existingChars.map((c) => ({
      name: c.name,
      aliases: c.aliases,
      outfitNames: (c.outfits ?? []).map(o => o.name),
    })),
    existingLocs.map((l) => ({ name: l.name, aliases: l.aliases })),
    existingFactions.map((f) => ({ name: f.name, costumePrompt: f.costumePrompt })),
    existingProps.map((p) => ({ name: p.name }))
  );
  const rawNovelText = episode.paragraphs.map((p) => `[${p.idx}] ${p.text}`).join("\n\n");
  const novelText = rawNovelText;

  const userPrompt = buildS1Prompt(episode.number, episode.title ?? "", bibleContext, novelText);

  await Job.findByIdAndUpdate(jobId, { progress: 0.3, statusMessage: "AI กำลังอ่านนิยายและสกัดตัวละคร / สถานที่ / กลุ่ม…" });

  const { data, tokens } = await callStructured({
    system: loadPrompt("s1-bible.txt"),
    user: userPrompt,
    schema: BibleExtractionResult,
    temperature: 0.1,
    maxTokens: 32000,
  });

  await Job.findByIdAndUpdate(jobId, { progress: 0.6, statusMessage: "บันทึกข้อมูลลงฐานข้อมูล…" });

  await mergeCharacters(projectId, episode.number, data.characters, existingChars);
  await mergeLocations(projectId, episode.number, data.locations, existingLocs);
  await mergeFactions(projectId, data.factions ?? [], existingFactions);
  await mergeProps(projectId, episode.number, data.props ?? [], existingChars);

  if (data.episodeSummary) await Episode.updateOne({ _id: episodeId }, { $set: { summary: data.episodeSummary } });
  await Episode.updateOne({ _id: episodeId, status: "ingested" }, { $set: { status: "bible_review" } });

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
        voice: { ...char.voice, ...(char.voicePrompt ? { voicePrompt: char.voicePrompt } : {}) },
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
          voice: { ...char.voice, ...(char.voicePrompt ? { voicePrompt: char.voicePrompt } : {}) },
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
        voice: { ...char.voice, ...(char.voicePrompt ? { voicePrompt: char.voicePrompt } : {}) },
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

// ---- Merge Props ----

async function mergeProps(
  projectId: string,
  epNumber: number,
  incoming: LLMPropObjectType[],
  existingChars: Array<{ _id: Types.ObjectId; name: string; aliases: string[] }>
): Promise<void> {
  for (const prop of incoming) {
    // resolve ownedByNames -> characterIds
    const ownedBy = prop.ownedByNames
      .map(n => existingChars.find(c =>
        c.name.toLowerCase() === n.toLowerCase() ||
        c.aliases.some(a => a.toLowerCase() === n.toLowerCase())
      )?._id)
      .filter(Boolean) as Types.ObjectId[];

    await PropObject.findOneAndUpdate(
      { projectId, name: prop.name },
      {
        $set: {
          category: prop.category,
          description: prop.description,
          visualPrompt: prop.visualPrompt,
          significance: prop.significance,
          ownedBy,
        },
        $addToSet: {
          aliases: { $each: prop.aliases },
          episodes: epNumber,
        },
      },
      { upsert: true, new: true }
    );
  }
}

// ---- Merge Factions ----

async function mergeFactions(
  projectId: string,
  incoming: Array<{ name: string; description: string; costumeDescription: string; costumePrompt: string }>,
  existing: Array<{ name: string; costumePrompt: string }>
): Promise<void> {
  if (incoming.length === 0) return;
  const existingNames = new Set(existing.map((f) => f.name.toLowerCase().trim()));
  const toAdd = incoming.filter((f) => !existingNames.has(f.name.toLowerCase().trim()));
  const toUpdate = incoming.filter((f) => existingNames.has(f.name.toLowerCase().trim()));

  if (toAdd.length > 0) {
    await Project.findByIdAndUpdate(projectId, {
      $push: { factions: { $each: toAdd } },
    });
  }
  for (const f of toUpdate) {
    await Project.findOneAndUpdate(
      { _id: projectId, "factions.name": f.name },
      { $set: { "factions.$.costumeDescription": f.costumeDescription, "factions.$.costumePrompt": f.costumePrompt } }
    );
  }
}

// ---- Helpers ----

function buildBibleContext(
  chars: Array<{ name: string; aliases: string[]; outfitNames: string[] }>,
  locs: Array<{ name: string; aliases: string[] }>,
  factions: Array<{ name: string; costumePrompt: string }>,
  props: Array<{ name: string }> = []
): string {
  if (chars.length === 0 && locs.length === 0 && factions.length === 0 && props.length === 0) return "(no existing Bible)";
  const charList = chars.map((c) => {
    const outfits = c.outfitNames.length > 0 ? ` [known outfits: ${c.outfitNames.join(", ")}]` : "";
    return `- ${c.name}${outfits}`;
  }).join("\n");
  const locList = locs.map((l) => `- ${l.name}`).join("\n");
  const facList = factions.map((f) => `- ${f.name}: ${f.costumePrompt}`).join("\n");
  const propList = props.map((p) => `- ${p.name}`).join("\n");
  return `Existing characters:\n${charList || "(none)"}\n\nExisting locations:\n${locList || "(none)"}\n\nExisting factions/costumes:\n${facList || "(none)"}\n\nExisting props:\n${propList || "(none)"}`;
}

function buildS1Prompt(epNumber: number, title: string, bibleContext: string, novelText: string): string {
  return `
## Existing Bible (reuse names for recurring characters and locations)
${bibleContext}

## Novel text EP ${epNumber}: ${title}
${novelText}

## Instructions
- Extract ALL new characters, locations, factions, and props from this episode — including monsters, creatures, beasts, demons, or spirits (use role: "monster")
- For existing characters (listed above): include them ONLY if they appear in a NEW outfit not listed in [known outfits]. Include only the new outfit(s) in their outfits array
- Extract ALL factions/groups that share a costume (sect ranks, unit types, etc.)
- Extract ALL significant props: weapons, artifacts, key items that appear in multiple scenes or are plot-critical — skip generic background items
- For appearance fields (hair/skin/eyes/build/distinguishing/defaultOutfit): NEVER output "unknown" — always infer a reasonable value and add the field to inferredFields
- If a character belongs to a faction listed in the existing Bible, their outfit MUST reference that faction's costumePrompt as the base
- All prompt fields must be in English (appearanceBlock, characterSheetPrompt, outfitPrompt, outfitSheetPrompt, locationBlock, masterPrompt, costumePrompt)
- Every character must have at least 1 outfit with outfitPrompt and outfitSheetPrompt filled
- voicePrompt: write a concise English TTS voice description for the character, e.g. "young adult male, medium pitch, calm and measured pace, slight formal accent, speaks with quiet authority"

## Return JSON:
\`\`\`json
{
  "props": [ { "name": "ชื่อสิ่งของ", "aliases": [], "category": "weapon|artifact|clothing|document|container|tool|food|vehicle|other", "description": "บรรยายลักษณะภาษาไทย", "visualPrompt": "[material] [color] [shape] [condition] in English", "significance": "บทบาทในเรื่อง", "ownedByNames": ["ชื่อตัวละคร"] } ],
  "factions": [ { "name": "ชื่อกลุ่ม", "description": "", "costumeDescription": "บรรยายชุดภาษาไทย", "costumePrompt": "wearing [color] [material] [garment] with [details] in English" } ],
  "characters": [ { "name": "ชื่อตัวละคร", "aliases": [], "role": "main|support|extra|monster", "age": "", "personality": "", "appearance": { "hair": "(infer if unknown)", "skin": "(infer if unknown)", "eyes": "(infer if unknown)", "build": "(infer if unknown)", "distinguishing": "", "defaultOutfit": "(infer if unknown)", "inferredFields": ["hair","skin"] }, "outfits": [{ "name": "ชื่อชุด", "description": "คำอธิบายชุดภาษาไทย", "outfitPrompt": "[base appearance] wearing [faction costume or outfit details] in English", "outfitSheetPrompt": "live-action film character reference sheet, multiple views, front/side/back, [base appearance] wearing [outfit], white background, photorealistic, full body" }], "voice": { "gender": "", "ageRange": "", "pitch": "", "timbre": "", "pace": "", "accent": "", "defaultEmotion": "", "speechHabits": [], "sampleLines": [] }, "appearanceBlock": "base appearance in English without outfit", "characterSheetPrompt": "live-action film character reference sheet, multiple views, front/side/back, [base appearance] wearing [default outfit], white background, photorealistic, full body", "voicePrompt": "[age] [gender], [pitch] pitch, [pace] pace, [timbre], [accent if any], [emotion/manner]", "needsReview": false, "needsReviewReason": "" } ],
  "locations": [ { "name": "ชื่อสถานที่", "aliases": [], "type": "interior|exterior", "description": "", "timeOfDay": "", "lighting": "", "weather": "", "materials": "", "keyElements": [], "mood": "", "locationBlock": "location description in English", "masterPrompt": "image generation prompt in English", "relatedCharacterNames": [], "needsReview": false } ],
  "episodeSummary": "2-3 sentence summary"
}
\`\`\`
`.trim();
}
