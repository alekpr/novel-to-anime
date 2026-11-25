import { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../config/index.js";
import { callStructured } from "../llm/client.js";
import { Character } from "../models/Character.js";
import { Project } from "../models/Project.js";
import { supportedReferenceAudio, MAX_REFERENCE_AUDIO_BYTES } from "../utils/videoClipInputs.js";

const audioDir = (charId: string) => path.join(config.dataDir, "assets", "audio-ref", charId);
const audioPath = (charId: string, ext: string) => path.join(audioDir(charId), `ref.${ext}`);

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
    // ตัดทุกอย่างหลัง wearing ... จนถึงจุดที่เป็น instruction (Preserve/Neutral/plain/white background)
    const wearingMatch = prompt.match(/(?:The character wears?|wearing)\s+(.+?)(?:\s*\.\s*(?:Preserve|Neutral|plain|No weapons|white background)|$)/is);
    if (wearingMatch) return wearingMatch[1].trim().replace(/[.]+$/, '');
    // fallback: เอาแค่  200 ตัวอักษรแรก
    return prompt.slice(0, 200).replace(/[.]+$/, '');
  };

  const rawFactionOutfit = matchedFaction?.costumePrompt ? extractWearingPart(matchedFaction.costumePrompt) : "";
  const factionOutfitHint = rawFactionOutfit ? `wearing ${rawFactionOutfit}` : "";

  const factionContext = matchedFaction
    ? `FACTION: ${matchedFaction.name}\nCostume description (Thai): ${matchedFaction.costumeDescription || "(none)"}\nOutfit to use (English, outfit only): ${factionOutfitHint || "(see costumeDescription)"}`
    : factions.length > 0
      ? `Known factions:\n${factions.map(f => `- ${f.name}`).join("\n")}`
      : "";

  return {
    ap,
    distinguishing,
    matchedFaction,
    factionContext,
    factionOutfitHint,
    defaultOutfit: char.outfits?.[0]?.description ?? ap.defaultOutfit ?? matchedFaction?.costumeDescription ?? "(use faction costume if applicable)",
  };
}

export async function characterRoutes(app: FastifyInstance) {
  app.addContentTypeParser(/^multipart\/form-data\b/i, { parseAs: "buffer", bodyLimit: MAX_REFERENCE_AUDIO_BYTES + 1_000 }, (_req, body, done) => done(null, body));

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

  // Audio Reference — upload, serve, delete
  app.post("/characters/:id/audio-reference", {
    bodyLimit: MAX_REFERENCE_AUDIO_BYTES + 1_000,
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id);
    if (!char) return reply.code(404).send({ error: "Not found" });
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: "กรุณาแนบไฟล์เสียง" });
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(req.body as Buffer), { headers: { "Content-Type": req.headers["content-type"] ?? "" } }).formData();
    } catch {
      return reply.code(400).send({ error: "อ่านไฟล์เสียงไม่สำเร็จ" });
    }
    const file = form.get("audio");
    if (!file || typeof file === "string") return reply.code(400).send({ error: "กรุณาแนบไฟล์เสียงในฟิลด์ audio" });
    if (!supportedReferenceAudio(file.name, file.size)) return reply.code(422).send({ error: "ใช้ไฟล์ MP3, WAV, M4A, AAC, OGG หรือ FLAC ขนาดไม่เกิน 20 MB" });
    const ext = file.name.split(".").pop()!.toLowerCase();
    const dest = audioPath(id, ext);
    const partial = dest + ".partial";
    try {
      await mkdir(audioDir(id), { recursive: true });
      // ลบไฟล์เก่าทุก ext ก่อน
      for (const e of ["mp3","wav","m4a","aac","ogg","flac"]) {
        await unlink(audioPath(id, e)).catch(() => {});
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const { writeFile } = await import("node:fs/promises");
      await writeFile(partial, buf);
      await rename(partial, dest);
    } catch {
      await rm(partial, { force: true }).catch(() => {});
      return reply.code(500).send({ error: "บันทึกไฟล์เสียงไม่สำเร็จ" });
    }
    const ref = `audio-ref/${id}/ref.${ext}`;
    await Character.findByIdAndUpdate(id, { $set: { "voice.audioReference": ref } });
    return { audioReference: ref };
  });

  app.get("/characters/:id/audio-reference", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).select("voice").lean() as any;
    if (!char?.voice?.audioReference) return reply.code(404).send({ error: "ไม่พบไฟล์เสียงอ้างอิง" });
    const file = path.join(config.dataDir, "assets", char.voice.audioReference);
    try {
      const { size } = await stat(file);
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" };
      return reply.header("Content-Type", mime[ext] ?? "audio/mpeg").header("Content-Length", size).send(createReadStream(file));
    } catch {
      return reply.code(404).send({ error: "ไม่พบไฟล์เสียงอ้างอิง" });
    }
  });

  app.delete("/characters/:id/audio-reference", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).select("voice").lean() as any;
    if (!char?.voice?.audioReference) return reply.code(404).send({ error: "ไม่พบไฟล์เสียงอ้างอิง" });
    const file = path.join(config.dataDir, "assets", char.voice.audioReference);
    await rm(file, { force: true }).catch(() => {});
    await Character.findByIdAndUpdate(id, { $unset: { "voice.audioReference": "" } });
    return { deleted: true };
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
    const { ap, distinguishing, matchedFaction, factionContext, factionOutfitHint } = buildCharacterContext(char, factions);

    const ResetResult = z.object({
      appearanceBlock: z.string(),
      characterSheetPrompt: z.string(),
      outfitPrompt: z.string(),
      appearance: z.object({
        hair: z.string().default(""),
        skin: z.string().default(""),
        eyes: z.string().default(""),
        build: z.string().default(""),
      }).default({}),
    });

    const outfitInstruction = factionOutfitHint || "wearing appropriate cultivation sect outfit";

    const { data } = await callStructured({
      system: "You are an anime character designer. STRICT RULES: (1) appearanceBlock = face/hair/skin/build ONLY, no outfit words. (2) characterSheetPrompt must be ONE clean sentence. (3) NEVER invent scars/eyepatches/unique features unless stated. (4) NEVER output 'unknown'.",
      user: `Character: ${char.name} (${char.role})
Personality: ${char.personality || "unspecified"}
Distinguishing: ${distinguishing || "(none stated)"}
${factionContext ? `\n${factionContext}` : ""}

Generate:
1. appearance — { hair, skin, eyes, build } each as a short English descriptor (e.g. "short black hair", "fair skin", "dark eyes", "lean build")
2. appearanceBlock — combine appearance into one line: "[hair], [eyes], [skin], [build]" — NO outfit
3. outfitPrompt — "[appearanceBlock] ${outfitInstruction}"
4. characterSheetPrompt — "anime character sheet, multiple views, front/side/back, [appearanceBlock] ${outfitInstruction}, white background, reference sheet style, full body"

Return JSON: { "appearance": { "hair": "...", "skin": "...", "eyes": "...", "build": "..." }, "appearanceBlock": "...", "characterSheetPrompt": "...", "outfitPrompt": "..." }`,
      schema: ResetResult,
      temperature: 0.2,
    });

    const updateSet: Record<string, unknown> = {
      appearanceBlock: data.appearanceBlock,
      characterSheetPrompt: data.characterSheetPrompt,
      "appearance.hair": data.appearance?.hair || ap.hair || "",
      "appearance.skin": data.appearance?.skin || ap.skin || "",
      "appearance.eyes": data.appearance?.eyes || ap.eyes || "",
      "appearance.build": data.appearance?.build || ap.build || "",
      "appearance.inferredFields": [...new Set([
        ...(ap.inferredFields ?? []),
        ...(["hair","skin","eyes","build"] as const).filter(f => !ap[f] && !(data.appearance as any)?.[f]),
      ])],
    };
    if (char.outfits?.length > 0) {
      updateSet["outfits.0.outfitPrompt"] = data.outfitPrompt;
      updateSet["outfits.0.outfitSheetPrompt"] = data.characterSheetPrompt;
      const updated = await Character.findByIdAndUpdate(id, {
        $set: updateSet, $unset: { referenceWardrobe: "", "outfits.0.referenceAppearance": "" },
      }, { new: true });
      return updated;
    } else if (matchedFaction) {
      const updated = await Character.findByIdAndUpdate(id, {
        $set: updateSet,
        $unset: { referenceWardrobe: "" },
        $push: { outfits: {
          name: `ชุด${matchedFaction.name}`,
          description: matchedFaction.costumeDescription || matchedFaction.name,
          outfitPrompt: data.outfitPrompt,
          outfitSheetPrompt: data.characterSheetPrompt,
          usedInScenes: [],
        }},
      }, { new: true });
      return updated;
    }
    const updated = await Character.findByIdAndUpdate(id, {
      $set: updateSet, $unset: { referenceWardrobe: "" },
    }, { new: true });
    return updated;
  });

  app.post("/characters/:id/regenerate-voice-prompt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    const sampleLines: string[] = char.voice?.sampleLines ?? [];
    const speechHabits: string[] = char.voice?.speechHabits ?? [];
    const defaultEmotion: string = char.voice?.defaultEmotion || "neutral";

    const VoiceResult = z.object({
      voicePrompt: z.string(),
      audioLines: z.array(z.object({ tag: z.string(), line: z.string() })).min(3).max(5),
    });

    const { data } = await callStructured({
      system: "You are a Thai voice actor director. Generate character dialogue lines with emotion tags for TTS systems like ElevenLabs or Fish Audio.",
      user: `Character: ${char.name} (${char.role})
Personality: ${char.personality || "unspecified"}
Age: ${char.age || "unspecified"}
Default emotion: ${defaultEmotion}
Speech habits: ${speechHabits.join(", ") || "none"}
Existing sample lines: ${sampleLines.join(" / ") || "none"}

Generate:
1. voicePrompt — one short Thai sentence describing this character's voice style (e.g. "เสียงหนักแน่น พูดช้า สำเนียงสุภาพ")
2. audioLines — 3-5 dialogue lines IN THAI that this character would naturally say, each with an emotion tag
   - tag: one of [neutral] [happy] [sad] [angry] [calm] [excited] [fearful] [serious] [gentle] [cold]
   - line: a natural Thai sentence ≤ 15 seconds when spoken aloud
   - Vary the emotions to showcase the character's range
   - Use speech habits if any

Return JSON: { "voicePrompt": "...", "audioLines": [{ "tag": "[calm]", "line": "..." }, ...] }`,
      schema: VoiceResult,
      temperature: 0.7,
    });

    const updated = await Character.findByIdAndUpdate(
      id,
      { $set: { "voice.voicePrompt": data.voicePrompt, "voice.audioLines": data.audioLines } },
      { new: true }
    );
    return updated;
  });

  // Regenerate appearanceBlock + characterSheetPrompt (ใส่ faction + context ตัวละครอื่น)
  app.post("/characters/:id/regenerate-appearance", async (req, reply) => {
    const { id } = req.params as { id: string };
    const char = await Character.findById(id).lean() as any;
    if (!char) return reply.code(404).send({ error: "Not found" });

    const project = await Project.findById(char.projectId).lean() as any;
    const factions: Faction[] = project?.factions ?? [];
    const { distinguishing, matchedFaction, factionContext, factionOutfitHint } = buildCharacterContext(char, factions);

    const others = await Character.find({ projectId: char.projectId, _id: { $ne: char._id } })
      .select("name role appearanceBlock").lean() as any[];
    const othersContext = others.filter((o) => o.appearanceBlock)
      .map((o) => `- ${o.name} (${o.role}): ${o.appearanceBlock}`).join("\n");

    const AppearanceResult = z.object({
      appearanceBlock: z.string(),
      characterSheetPrompt: z.string(),
      outfitPrompt: z.string(),
    });

    const outfitInstruction = factionOutfitHint || "wearing appropriate cultivation sect outfit";

    const { data } = await callStructured({
      system: "You are an anime character designer. STRICT RULES: (1) appearanceBlock = face/hair/skin/build ONLY, no outfit. (2) characterSheetPrompt must be ONE clean sentence. (3) NEVER invent scars/eyepatches unless stated. (4) NEVER output 'unknown'.",
      user: `Regenerate appearance for: ${char.name} (${char.role})
Personality: ${char.personality || "unspecified"}
Distinguishing: ${distinguishing || "(none stated)"}
${factionContext ? `\n${factionContext}` : ""}

OTHER characters (DO NOT duplicate their look):
${othersContext || "(none)"}

Generate:
1. appearanceBlock — SHORT, face/hair/skin/build only, must differ from others above
2. outfitPrompt — "[appearanceBlock] ${outfitInstruction}"
3. characterSheetPrompt — "anime character sheet, multiple views, front/side/back, [appearanceBlock] ${outfitInstruction}, white background, reference sheet style, full body"

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
      updateSet["outfits.0.outfitSheetPrompt"] = data.characterSheetPrompt;
      const updated = await Character.findByIdAndUpdate(id, {
        $set: updateSet, $unset: { referenceWardrobe: "", "outfits.0.referenceAppearance": "" },
      }, { new: true });
      return updated;
    } else if (matchedFaction) {
      const updated = await Character.findByIdAndUpdate(id, {
        $set: updateSet,
        $unset: { referenceWardrobe: "" },
        $push: { outfits: {
          name: `ชุด${matchedFaction.name}`,
          description: matchedFaction.costumeDescription || matchedFaction.name,
          outfitPrompt: data.outfitPrompt,
          outfitSheetPrompt: data.characterSheetPrompt,
          usedInScenes: [],
        }},
      }, { new: true });
      return updated;
    }
    const updated = await Character.findByIdAndUpdate(id, {
      $set: updateSet, $unset: { referenceWardrobe: "" },
    }, { new: true });
    return updated;
  });
}
