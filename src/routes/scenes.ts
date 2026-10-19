import { FastifyInstance } from "fastify";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";

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
    const s = await Scene.findByIdAndUpdate(id, req.body as object, { new: true });
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
      .populate("locationId", "name");
  });
}
