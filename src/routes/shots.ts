import { FastifyInstance } from "fastify";
import { z } from "zod";
import { callStructured } from "../llm/client.js";
import { buildShotsForScene } from "../services/shot.service.js";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";

export async function shotRoutes(app: FastifyInstance) {
  app.get("/shots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Shot.findById(id)
      .populate("characterIds", "name appearanceBlock voice")
      .populate("locationId", "name locationBlock");
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });

  app.patch("/shots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Shot.findByIdAndUpdate(id, req.body as object, { new: true });
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });

  // mark dialogue line reviewed
  app.patch("/shots/:id/dialogue/:idx", async (req, reply) => {
    const { id, idx } = req.params as { id: string; idx: string };
    const body = req.body as { reviewed?: boolean; lineTh?: string; tone?: string };
    const i = parseInt(idx, 10);
    const update: Record<string, unknown> = {};
    if (body.reviewed !== undefined) update[`dialogue.${i}.reviewed`] = body.reviewed;
    if (body.lineTh !== undefined) update[`dialogue.${i}.lineTh`] = body.lineTh;
    if (body.tone !== undefined) update[`dialogue.${i}.tone`] = body.tone;
    const s = await Shot.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });

  // generate shots for a single scene
  app.post("/scenes/:id/generate-shots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = await Scene.findById(id).lean();
    if (!scene) return reply.code(404).send({ error: "Scene not found" });

    const episode = await Episode.findById(scene.episodeId).lean();
    if (!episode) return reply.code(404).send({ error: "Episode not found" });

    // ลบ shots เดิมทั้งหมดของ scene นี้ก่อน
    await Shot.deleteMany({ sceneId: id });

    const characters = await Character.find({ projectId: scene.projectId, status: "approved" }).lean() as any[];

    const result = await buildShotsForScene(scene as any, episode as any, characters, episode.summary ?? "");

    const shots = await Shot.find({ sceneId: id }).sort({ order: 1 }).lean();
    return { shotCount: shots.length, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  });

  // generate dialogue for a shot using LLM
  app.post("/shots/:id/generate-dialogue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const shot = await Shot.findById(id).lean();
    if (!shot) return reply.code(404).send({ error: "Not found" });

    const scene = await Scene.findById(shot.sceneId).lean();
    const chars = await Character.find({
      _id: { $in: shot.characterIds }
    }, "name personality voice").lean();

    const charContext = chars.map(c =>
      `- ${c.name}: ${(c as any).personality ?? ""} | speechHabits: [${((c as any).voice?.speechHabits ?? []).join(", ")}]`
    ).join("\n");

    const DialogueResult = z.object({
      dialogue: z.array(z.object({
        speakerName: z.string(),
        lineTh: z.string(),
        tone: z.string().default(""),
      })).min(1),
    });

    const { data } = await callStructured({
      system: "คุณคือนักเขียนบทอนิเมะ สร้างบทสนทนาที่เป็นธรรมชาติและตรงกับบุคลิกตัวละคร ตอบเป็น JSON เท่านั้น",
      user: `สร้างบทสนทนาสำหรับ shot นี้:

Scene: ${(scene as any)?.title ?? ""} | อารมณ์: ${(scene as any)?.mood ?? ""}
Shot: ${shot.shotCode} | action: ${shot.action} | emotion: ${shot.emotion ?? ""}

ตัวละครในฉาก:
${charContext || "(ไม่มี)"}

สร้างบทสนทนา 1-3 ประโยคที่เหมาะกับ action และ emotion ของ shot นี้
ตอบ JSON: { "dialogue": [{ "speakerName": "ชื่อ", "lineTh": "บทพูด", "tone": "น้ำเสียง" }] }`,
      schema: DialogueResult,
      temperature: 0.7,
    });

    const charMap = new Map(chars.map(c => [c.name, c]));
    const newLines = data.dialogue.map(d => ({
      speakerId: charMap.get(d.speakerName)?._id,
      lineTh: d.lineTh,
      tone: d.tone,
      source: "generated",
      reviewed: false,
    }));

    const updated = await Shot.findByIdAndUpdate(
      id,
      { $push: { dialogue: { $each: newLines } } },
      { new: true }
    );
    return updated;
  });

  // mark dialogue reviewed
  app.post("/shots/:id/review-dialogue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Shot.findByIdAndUpdate(
      id,
      { $set: { "dialogue.$[].reviewed": true } },
      { new: true }
    );
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });
}
