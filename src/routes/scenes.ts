import { FastifyInstance } from "fastify";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { generateBgmPrompt, getBgmPrompt } from "../services/bgm.service.js";
import { generateDialogueScript, getDialogueScript } from "../services/dialogue.service.js";

export async function sceneRoutes(app: FastifyInstance) {
  app.get("/episodes/:id/scenes", async (req) => {
    const { id } = req.params as { id: string };
    return Scene.find({ episodeId: id })
      .sort({ order: 1 })
      .populate("locationId", "name")
      .populate("characterIds", "name role");
  });

  app.get("/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Scene.findById(id)
      .populate("locationId", "name locationBlock")
      .populate("characterIds", "name appearanceBlock");
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });

  app.patch("/scenes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const current = await Scene.findById(id).lean();
    if (!current) return reply.code(404).send({ error: "Not found" });
    const changes = req.body as Record<string, unknown>;
    const update = current.dramaBeat
      ? {
          $set: {
            ...Object.fromEntries(Object.entries(changes).filter(([key]) =>
              ["title", "summary", "timeOfDay", "mood"].includes(key))),
            shotsApproved: false,
            "clips.$[].stale": true,
          },
        }
      : changes;
    const s = await Scene.findByIdAndUpdate(id, update, { new: true });
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });

  app.post("/scenes/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Scene.findByIdAndUpdate(id, { status: "approved" }, { new: true });
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });

  // ดู shots ของ scene
  app.get("/scenes/:id/shots", async (req) => {
    const { id } = req.params as { id: string };
    return Shot.find({ sceneId: id })
      .sort({ order: 1 })
      .populate("characterIds", "name")
      .populate("dialogue.speakerId", "name")
      .populate("locationId", "name");
  });

  app.get("/scenes/:id/bgm", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { bgmPrompt: await getBgmPrompt(id) };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.post("/scenes/:id/generate-bgm", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { bgmPrompt: await generateBgmPrompt(id) };
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });

  app.get("/scenes/:id/dialogue-script", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { dialogueScript: await getDialogueScript(id) };
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message });
    }
  });

  app.post("/scenes/:id/generate-dialogue-script", async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return { dialogueScript: await generateDialogueScript(id) };
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });
}
