import { FastifyInstance } from "fastify";
import { Scene } from "../models/Scene.js";
import { runOptimizeScene } from "../services/optimize.service.js";

export async function optimizeRoutes(app: FastifyInstance) {
  // GET cached result
  app.get("/scenes/:id/optimized", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = await Scene.findById(id, { optimizedClips: 1 }).lean();
    if (!scene) return reply.code(404).send({ error: "Not found" });
    return (scene as any).optimizedClips ?? null;
  });

  // POST trigger optimization
  app.post("/scenes/:id/optimize", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { maxClipSec?: number } | undefined;
    try {
      const result = await runOptimizeScene(id, body?.maxClipSec);
      return result;
    } catch (err: any) {
      return reply.code(500).send({ error: err.message });
    }
  });

  // GET all scenes optimized for an episode
  app.get("/episodes/:id/optimized", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scenes = await Scene.find({ episodeId: id }, {
      sceneCode: 1, title: 1, optimizedClips: 1, clips: 1,
    }).sort({ order: 1 }).lean();
    return scenes.map(sc => ({
      _id: sc._id,
      sceneCode: (sc as any).sceneCode,
      title: (sc as any).title,
      hasOptimized: !!(sc as any).optimizedClips,
      clipCount: ((sc as any).clips ?? []).length,
      optimizedClips: (sc as any).optimizedClips ?? null,
    }));
  });
}
