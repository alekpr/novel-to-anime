import { FastifyInstance } from "fastify";
import { isObjectIdOrHexString } from "mongoose";
import { Scene } from "../models/Scene.js";
import { Episode } from "../models/Episode.js";
import { Shot } from "../models/Shot.js";
import { runPromptGeneration } from "../services/prompt.service.js";
import { reviseVideoPrompt, VideoPromptRevisionError, VideoPromptRevisionInput } from "../services/videoPromptRevision.service.js";
import { ProjectActivityError } from "../services/projectLifecycle.service.js";
import { DRAMA_REPLAN_MESSAGE, hasInvalidDramaScenes } from "../utils/shortDrama.js";
import { countDramaDialogue, DRAMA_DIALOGUE_REQUIRED } from "../utils/dramaDialogue.js";
import { buildEpisodeSubtitles, SubtitleExportError, type SubtitleScene } from "../utils/episodeSubtitles.js";

async function episodeHasApprovedDialogue(scenes: readonly { _id: unknown; dramaBeat?: unknown; shotsApproved?: unknown }[]) {
  const approvedDramaSceneIds = scenes.filter(scene => scene.dramaBeat && scene.shotsApproved === true).map(scene => scene._id);
  const shots = await Shot.find({ sceneId: { $in: approvedDramaSceneIds }, "dialogue.reviewed": true })
    .select("characterIds dialogue").lean();
  return countDramaDialogue(shots, true) > 0;
}

export async function promptRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/episodes/:id/subtitles", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params;
    const episode = isObjectIdOrHexString(id) ? await Episode.findById(id).select("number").lean() : null;
    if (!episode) return reply.code(404).send({ error: "ไม่พบตอนนี้" });

    const scenes = await Scene.find({ episodeId: id }).sort({ order: 1, _id: 1 })
      .select("sceneCode clips.clipCode clips.durationSec clips.stale clips.videoPrompt").lean<SubtitleScene[]>();
    try {
      return {
        filename: `EP${String(episode.number).padStart(2, "0")}-subtitles.srt`,
        ...buildEpisodeSubtitles(scenes),
      };
    } catch (error) {
      if (error instanceof SubtitleExportError) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.post<{ Params: { sceneId: string; clipCode: string } }>("/scenes/:sceneId/clips/:clipCode/revise-prompt", async (req, reply) => {
    const body = VideoPromptRevisionInput.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "ใส่คอมเมนต์ไม่เกิน 2,000 ตัวอักษรและเลือกคลิปที่สร้างเสร็จ" });
    try {
      return await reviseVideoPrompt(req.params.sceneId, req.params.clipCode, body.data);
    } catch (error) {
      if (error instanceof VideoPromptRevisionError || error instanceof ProjectActivityError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  // สร้าง prompt ทุก scene ของ episode พร้อมกัน (concurrency 2)
  app.post("/episodes/:id/generate-all-prompts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ep = await Episode.findById(id).lean();
    if (!ep) return reply.code(404).send({ error: "Episode not found" });

    const scenes = await Scene.find({ episodeId: id }).select("_id sceneCode dramaBeat shotsApproved estDurationSec").sort({ order: 1 }).lean();
    if (scenes.length === 0) return reply.code(400).send({ error: "No scenes found" });
    if (hasInvalidDramaScenes(scenes)) return reply.code(409).send({ error: DRAMA_REPLAN_MESSAGE });

    if (scenes.some(scene => scene.dramaBeat && !scene.shotsApproved)) {
      return reply.code(409).send({ error: "อนุมัติ All ให้ครบทุกซีนก่อนสร้างพรอมป์ทั้งตอน" });
    }
    if (scenes.some(scene => scene.dramaBeat) && !await episodeHasApprovedDialogue(scenes)) {
      return reply.code(409).send({ error: DRAMA_DIALOGUE_REQUIRED });
    }

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
    return { total: scenes.length, results: results.sort((a, b) => a.sceneCode.localeCompare(b.sceneCode, undefined, { numeric: true })) };
  });

  // S4a+S4b: สร้าง video prompt + แบ่ง clips สำหรับ scene เดียว
  app.post("/scenes/:id/generate-prompt", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = await Scene.findById(id).lean();
    if (!scene) return reply.code(404).send({ error: "Scene not found" });
    if (hasInvalidDramaScenes([scene])) return reply.code(409).send({ error: DRAMA_REPLAN_MESSAGE });

    if (scene.dramaBeat && !scene.shotsApproved) {
      return reply.code(409).send({ error: "อนุมัติ All ของซีนในหน้า Shots ก่อน" });
    }
    if (scene.dramaBeat) {
      const scenes = await Scene.find({ episodeId: scene.episodeId, shotsApproved: true }).select("dramaBeat shotsApproved").lean();
      if (!await episodeHasApprovedDialogue(scenes)) return reply.code(409).send({ error: DRAMA_DIALOGUE_REQUIRED });
    }
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
