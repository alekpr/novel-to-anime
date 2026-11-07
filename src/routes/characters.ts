import { FastifyInstance } from "fastify";
import { z } from "zod";
import { callStructured } from "../llm/client.js";
import { Character } from "../models/Character.js";
import { Project } from "../models/Project.js";

type Faction = { name: string; description: string; costumeDescription: string; costumePrompt: string };

function buildCharacterContext(char: any, factions: Faction[]) {
  const ap = char.appearance ?? {};
  const distinguishing = ap.distinguishing ?? "";

  const matchedFaction = factions.find(f =>
    distinguishing.includes(f.name) ||
    (char.personality ?? "").includes(f.name) ||
    (char.aliases ?? []).some((a: string) => a.includes(f.name))
  );

  // ถ้า costumePrompt ยาวมาก (character sheet style) — ดึงแค่ส่วน wearing...
  const extractWearingPart = (prompt: string) => {
    const match = prompt.match(/wearing (.+?)(?:\.|,\s*(?:Preserve|Neutral|plain|white background)|$)/is);
    return match ? `wearing ${match[1].trim()}` : prompt.slice(0, 300);
  };

  const factionOutfitHint = matchedFaction?.costumePrompt
    ? extractWearingPart(matchedFaction.costumePrompt)
    : "";

  const factionContext = matchedFaction
    ? `FACTION: ${matchedFaction.name}\nCostume description (Thai): ${matchedFaction.costumeDescription || "(none)"}\nOutfit style (use this as the outfit): ${factionOutfitHint}`
    : factions.length > 0
      ? `Known factions:\n${factions.map(f => `- ${f.name}`).join("\n")}`
      : "";

  return {
    ap,
    distinguishing,
    matchedFaction,
    factionContext,
    defaultOutfit: char.outfits?.[0]?.description ?? ap.defaultOutfit ?? matchedFaction?.costumeDescription ?? "(use faction costume if applicable)",
  };
}

export async function characterRoutes(app: FastifyInstance) {
  app.get("/projects/:id/characters", async (req) => {
    const { id } = req.params as { id: string };
    return Character.find({ projectId: id }).sort({ name: 1 });
  });

  app.get("/characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await Character.findById(id);
    if (!c) return reply.code(404).send({ error: "Not found" });
    return c;
  });

  app.patch("/characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await Character.findByIdAndUpdate(id, req.body as object, { new: true });
    if (!c) return reply.code(404).send({ error: "Not found" });
    return c;
  });

  // Approve + lock appearanceBlock
  app.post("/characters/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await Character.findByIdAndUpdate(
      id,
      { $set: { status: "approved", needsReview: false }, $inc: { version: 1 } },
      { new: true }
    );
    if (!c) return reply.code(404).send({ error: "Not found" });
    return c;
  });

  // Delete (เฉพาะ draft หรือ needsReview)
  app.delete("/characters/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await Character.findById(id);
    if (!c) return reply.code(404).send({ error: "Not found" });
    if (c.status === "approved" && !c.needsReview) {
      return reply.code(400).send({ error: "Cannot delete approved character" });
    }
    await Character.findByIdAndDelete(id);
    return { deleted: true };
  });

  // Generate outfitPrompt + outfitSheetPrompt สำหรับ outfit ที่ยังไม่มี prompt
  app.post("/characters/:id/generate-outfit-prompts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    const outfits: Array<{ name: string; description: string; outfitPrompt?: string; outfitSheetPrompt?: string }> = char.outfits ?? [];
    const missing = outfits.filter((o) => !o.outfitPrompt || !o.outfitSheetPrompt);
    if (missing.length === 0) return { updated: 0 };

    const OutfitPromptsResult = z.object({
      outfits: z.array(z.object({
        name: z.string(),
        outfitPrompt: z.string(),
        outfitSheetPrompt: z.string(),
      })),
    });

    const { data } = await callStructured({
      system: "You are an anime character designer. Generate English image prompts for character outfits. All prompts must be complete and self-contained, ready to use directly in an image generator.",
      user: `Character: ${char.name}
Base appearance (no outfit): ${char.appearanceBlock ?? ""}

Generate TWO prompts for each outfit:
1. outfitPrompt — for video/scene use: "[base appearance] wearing [outfit details: color, material, style, accessories]"
2. outfitSheetPrompt — for character sheet (turnaround + expressions): "anime character sheet, multiple views, front/side/back, [base appearance] wearing [outfit details], white background, reference sheet style"

Outfits to generate:
${missing.map((o) => `- name: "${o.name}"\n  description: "${o.description}"`).join("\n")}

Return JSON: { "outfits": [{ "name": "outfit name", "outfitPrompt": "...", "outfitSheetPrompt": "..." }] }`,
      schema: OutfitPromptsResult,
      temperature: 0.3,
    });

    const updatedChar = await Character.findById(id);
    if (!updatedChar) return reply.code(404).send({ error: "Not found" });

    for (const generated of data.outfits) {
      const idx = (updatedChar.outfits as any[]).findIndex(
        (o: any) => o.name.toLowerCase().trim() === generated.name.toLowerCase().trim()
      );
      if (idx !== -1) {
        await Character.findByIdAndUpdate(id, {
          $set: {
            [`outfits.${idx}.outfitPrompt`]: generated.outfitPrompt,
            [`outfits.${idx}.outfitSheetPrompt`]: generated.outfitSheetPrompt,
          },
        });
      }
    }

    const result = await Character.findById(id).lean();
    return { updated: data.outfits.length, character: result };
  });

  // Fix unknown fields in existing character (clean up old data)
  app.post("/characters/:id/fix-unknown", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    const UNKNOWN = /^unknown$/i;
    const ap = char.appearance ?? {};
    const apFields = ["hair", "skin", "eyes", "build", "defaultOutfit"];
    const inferred = new Set<string>(ap.inferredFields ?? []);
    const apSet: Record<string, string> = {};
    for (const f of apFields) {
      if (UNKNOWN.test(ap[f] ?? "")) { apSet[`appearance.${f}`] = ""; inferred.add(f); }
    }
    apSet["appearance.inferredFields"] = JSON.stringify([...inferred]) as any;

    const voice = char.voice ?? {};
    const voiceFields = ["gender", "ageRange", "pitch", "timbre", "pace", "accent", "defaultEmotion"];
    const voiceSet: Record<string, string> = {};
    for (const f of voiceFields) {
      if (UNKNOWN.test(voice[f] ?? "")) voiceSet[`voice.${f}`] = "";
    }

    const ageSet = UNKNOWN.test(char.age ?? "") ? { age: "" } : {};

    const $set = { ...apSet, ...voiceSet, ...ageSet,
      "appearance.inferredFields": [...inferred] };

    const updated = await Character.findByIdAndUpdate(id, { $set }, { new: true });
    return updated;
  });

  // Regenerate (ระบุ field ที่ต้องการ — ตอนนี้ reset เป็น draft ให้ S1 รันใหม่)
  app.post("/characters/:id/regenerate", async (req, reply) => {
    const { id } = req.params as { id: string };
    const c = await Character.findByIdAndUpdate(
      id,
      { $set: { status: "draft", needsReview: true } },
      { new: true }
    );
    if (!c) return reply.code(404).send({ error: "Not found" });
    return c;
  });

  // Reset appearanceBlock + characterSheetPrompt จาก appearance fields + faction context
  app.post("/characters/:id/reset-appearance", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    const project = await Project.findById(char.projectId).lean() as any;
    const factions: Faction[] = project?.factions ?? [];
    const { ap, distinguishing, factionContext, defaultOutfit } = buildCharacterContext(char, factions);

    const ResetResult = z.object({
      appearanceBlock: z.string(),
      characterSheetPrompt: z.string(),
      outfitPrompt: z.string(),
    });

    const { data } = await callStructured({
      system: "You are an anime character designer. Generate English image prompts. IMPORTANT: appearanceBlock describes ONLY the body/face/hair — NO outfit. The outfit goes in outfitPrompt and characterSheetPrompt only. NEVER output 'unknown'.",
      user: `Generate appearance prompts for this character.

Character: ${char.name} (${char.role}, age: ${char.age || "unspecified"})
Personality: ${char.personality || "unspecified"}
Hair: ${ap.hair || "(infer — typical for their role in a xianxia cultivation story)"}
Skin: ${ap.skin || "(infer)"}
Eyes: ${ap.eyes || "(infer)"}
Build: ${ap.build || "(infer)"}
Distinguishing: ${distinguishing || "(none stated)"}
${factionContext ? `\n${factionContext}` : ""}

Rules:
1. appearanceBlock — ONLY face/hair/skin/build/distinguishing features, NO outfit: e.g. "young male, short black hair, dark eyes, lean build"
2. outfitPrompt — "[appearanceBlock] [faction outfit style]" — MUST use faction outfit if provided above
3. characterSheetPrompt — "anime character sheet, multiple views, front/side/back, [appearanceBlock] [faction outfit style], white background, reference sheet style, full body"
4. Keep appearanceBlock SHORT and generic — do NOT invent scars, eyepatches, or unique features unless stated
5. Infer missing appearance details from role and faction context (xianxia cultivation setting)

Return JSON: { "appearanceBlock": "...", "characterSheetPrompt": "...", "outfitPrompt": "..." }`,
      schema: ResetResult,
      temperature: 0.2,
    });

    // อัปเดต outfit prompt ด้วยถ้ามี outfit อยู่แล้ว
    const updateSet: Record<string, unknown> = {
      appearanceBlock: data.appearanceBlock,
      characterSheetPrompt: data.characterSheetPrompt,
    };
    if (char.outfits?.length > 0) {
      updateSet["outfits.0.outfitPrompt"] = data.outfitPrompt;
    }

    const updated = await Character.findByIdAndUpdate(id, { $set: updateSet }, { new: true });
    return updated;
  });

  // Regenerate appearanceBlock + characterSheetPrompt (ใส่ faction + context ตัวละครอื่น)
  app.post("/characters/:id/regenerate-appearance", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    const project = await Project.findById(char.projectId).lean() as any;
    const factions: Faction[] = project?.factions ?? [];
    const { distinguishing, factionContext, defaultOutfit } = buildCharacterContext(char, factions);

    const others = await Character.find({ projectId: char.projectId, _id: { $ne: char._id } })
      .select("name role appearanceBlock").lean() as any[];
    const othersContext = others.filter((o) => o.appearanceBlock)
      .map((o) => `- ${o.name} (${o.role}): ${o.appearanceBlock}`).join("\n");

    const AppearanceResult = z.object({
      appearanceBlock: z.string(),
      characterSheetPrompt: z.string(),
      outfitPrompt: z.string(),
    });

    const { data } = await callStructured({
      system: "You are an anime character designer. Generate distinct English appearance descriptions. IMPORTANT: appearanceBlock = ONLY face/hair/skin/build — NO outfit. NEVER invent scars, eyepatches, or unique features unless stated in the source data. NEVER output 'unknown'.",
      user: `Regenerate appearance for this character. Make them visually DISTINCT from others.

Character: ${char.name} (${char.role}, age: ${char.age || "unspecified"})
Personality: ${char.personality || "unspecified"}
Distinguishing: ${distinguishing || "(none stated)"}
${factionContext ? `\n${factionContext}` : ""}

OTHER characters (DO NOT duplicate their look):
${othersContext || "(none)"}

Rules:
1. appearanceBlock — ONLY face/hair/skin/build, NO outfit — must differ from all others above
2. outfitPrompt — "[appearanceBlock] [faction outfit style]" — MUST use faction outfit if provided
3. characterSheetPrompt — "anime character sheet, multiple views, front/side/back, [appearanceBlock] [faction outfit style], white background, reference sheet style, full body"
4. Keep appearanceBlock SHORT: "[age] [gender], [hair], [eyes], [skin], [build]" — no invented unique features
5. Infer from xianxia cultivation context if fields are empty

Return JSON: { "appearanceBlock": "...", "characterSheetPrompt": "...", "outfitPrompt": "..." }`,
      schema: AppearanceResult,
      temperature: 0.7,
    });

    const updateSet: Record<string, unknown> = {
      appearanceBlock: data.appearanceBlock,
      characterSheetPrompt: data.characterSheetPrompt,
    };
    if (char.outfits?.length > 0) {
      updateSet["outfits.0.outfitPrompt"] = data.outfitPrompt;
    }

    const updated = await Character.findByIdAndUpdate(id, { $set: updateSet }, { new: true });
    return updated;
  });
}
