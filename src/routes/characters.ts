import { FastifyInstance } from "fastify";
import { z } from "zod";
import { callStructured } from "../llm/client.js";
import { Character } from "../models/Character.js";

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

  // Reset appearanceBlock + characterSheetPrompt จาก appearance fields ที่ S1 extract ไว้ (ยึดนิยายต้นฉบับ)
  app.post("/characters/:id/reset-appearance", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    const ap = char.appearance ?? {};
    const defaultOutfit = char.outfits?.[0]?.description ?? ap.defaultOutfit ?? "(use appropriate outfit for their role)";

    const ResetResult = z.object({
      appearanceBlock: z.string(),
      characterSheetPrompt: z.string(),
    });

    const { data } = await callStructured({
      system: "You are an anime character designer. Convert structured character data into English image prompts. Stay faithful to the source data — do not invent details.",
      user: `Generate appearance prompts strictly based on the following source data from the novel.

Character: ${char.name} (${char.role}, age: ${char.age ?? "unknown"})
Hair: ${ap.hair ?? ""}
Skin: ${ap.skin ?? ""}
Eyes: ${ap.eyes ?? ""}
Build: ${ap.build ?? ""}
Distinguishing features: ${ap.distinguishing ?? ""}
Default outfit: ${defaultOutfit}

Rules:
1. appearanceBlock — base appearance WITHOUT outfit: concise English descriptor "[hair], [eyes], [skin], [build], [distinguishing features]"
2. characterSheetPrompt — full prompt for character sheet image: "anime character sheet, multiple views, front/side/back, [full appearance with default outfit], white background, reference sheet style, full body"
3. Both must be faithful to the source data above — do not add details not mentioned

Return JSON: { "appearanceBlock": "...", "characterSheetPrompt": "..." }`,
      schema: ResetResult,
      temperature: 0.1,
    });

    const updated = await Character.findByIdAndUpdate(
      id,
      { $set: { appearanceBlock: data.appearanceBlock, characterSheetPrompt: data.characterSheetPrompt } },
      { new: true }
    );
    return updated;
  });

  // Regenerate appearanceBlock + characterSheetPrompt (ใส่ context ตัวละครอื่นเพื่อให้แตกต่าง)
  app.post("/characters/:id/regenerate-appearance", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    // ดึงตัวละครอื่นในโปรเจกต์เดียวกัน (ยกเว้นตัวนี้)
    const others = await Character.find({ projectId: char.projectId, _id: { $ne: char._id } })
      .select("name role appearanceBlock")
      .lean() as any[];

    const othersContext = others
      .filter((o) => o.appearanceBlock)
      .map((o) => `- ${o.name} (${o.role}): ${o.appearanceBlock}`)
      .join("\n");

    const AppearanceResult = z.object({
      appearanceBlock: z.string(),
      characterSheetPrompt: z.string(),
    });

    const { data } = await callStructured({
      system: "You are an anime character designer. Generate distinct, detailed English appearance descriptions. Each character MUST look visually unique — different hair color/style, eye color, build, and distinguishing features from all other characters.",
      user: `Regenerate the appearance for this character. Make them visually DISTINCT from all other characters listed below.

Character to regenerate:
- Name: ${char.name}
- Role: ${char.role}
- Age: ${char.age ?? "unknown"}
- Personality: ${char.personality ?? ""}
- Current appearanceBlock: ${char.appearanceBlock ?? "(none)"}

OTHER characters already defined (DO NOT duplicate their look):
${othersContext || "(none)"}

Rules:
1. appearanceBlock — base appearance WITHOUT outfit: "[hair], [eyes], [skin], [build], [distinguishing features]" — must differ from all others above
2. characterSheetPrompt — for character sheet image: "anime character sheet, multiple views, front/side/back, [full appearance with default outfit], white background, reference sheet style, full body"
3. Both must be in English, ready to paste into an image generator
4. Make the character memorable and visually unique

Default outfit info: ${(char.outfits?.[0]?.description) ?? char.appearance?.defaultOutfit ?? "(use appropriate outfit for their role)"}

Return JSON: { "appearanceBlock": "...", "characterSheetPrompt": "..." }`,
      schema: AppearanceResult,
      temperature: 0.7,
    });

    const updated = await Character.findByIdAndUpdate(
      id,
      { $set: { appearanceBlock: data.appearanceBlock, characterSheetPrompt: data.characterSheetPrompt } },
      { new: true }
    );
    return updated;
  });
}
