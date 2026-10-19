import { FastifyInstance } from "fastify";
import { Scene } from "../models/Scene.js";
import { Episode } from "../models/Episode.js";
import { runPromptGeneration } from "../services/prompt.service.js";

export async function promptRoutes(app: FastifyInstance) {
  // สร้าง prompt ทุก scene ของ episode พร้อมกัน (concurrency 2)
  app.post("/episodes/:id/generate-all-prompts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ep = await Episode.findById(id).lean();
    if (!ep) return reply.code(404).send({ error: "Episode not found" });

    const scenes = await Scene.find({ episodeId: id }).select("_id sceneCode").lean();
    if (scenes.length === 0) return reply.code(400).send({ error: "No scenes found" });

    // รัน concurrency 2 เพื่อไม่ให้ rate limit
    const results: { sceneCode: string; clipCount: number; errors: string[] }[] = [];
    const queue = [...scenes];
    async function worker() {
      while (queue.length > 0) {
        const scene = queue.shift()!;
        try {
          const r = await runPromptGeneration(scene._id.toString());
          results.push({ sceneCode: (scene as any).sceneCode, clipCount: r.clips.length, errors: r.validationErrors });
        } catch (e: any) {
          results.push({ sceneCode: (scene as any).sceneCode, clipCount: 0, errors: [e.message] });
        }
      }
    }
    await Promise.all([worker(), worker()]);
    return { total: scenes.length, results };
  });

  // S4a+S4b: สร้าง video prompt + แบ่ง clips สำหรับ scene เดียว
  app.post("/scenes/:id/generate-prompt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = await Scene.findById(id).lean();
    if (!scene) return reply.code(404).send({ error: "Scene not found" });

    // ล้าง clips เดิมก่อนเสมอ
    await Scene.findByIdAndUpdate(id, { $set: { clips: [], videoPromptDraft: null } });

    const result = await runPromptGeneration(id);
    return {
      clipCount: result.clips.length,
      totalDurationSec: result.clips.reduce((s, c) => s + c.durationSec, 0),
      validationErrors: result.validationErrors,
    };
  });

  // ดู clips ของ scene (พร้อม prompt)
  app.get("/scenes/:id/clips", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = await Scene.findById(id).select("sceneCode clips videoPromptDraft").lean();
    if (!scene) return reply.code(404).send({ error: "Not found" });
    return scene;
  });

  // ดู prompt ของ clip เดียว
  app.get("/scenes/:id/clips/:clipIndex", async (req, reply) => {
    const { id, clipIndex } = req.params as { id: string; clipIndex: string };
    const scene = await Scene.findById(id).select("clips").lean() as unknown as {
      clips: Array<{ clipCode: string; durationSec: number; videoPrompt: string; promptVersion: number }>;
    } | null;
    if (!scene) return reply.code(404).send({ error: "Not found" });
    const clip = scene.clips[parseInt(clipIndex, 10)];
    if (!clip) return reply.code(404).send({ error: "Clip not found" });
    return clip;
  });
}
