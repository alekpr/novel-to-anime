import type { FastifyInstance, FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { z } from "zod";
import { RunningHubSettings } from "../models/RunningHubSettings.js";
import { ProjectActivityError } from "../services/projectLifecycle.service.js";
import { getRunningHubWorkflow, publicRunningHubSettings, readRunningHubSettings, RunningHubError } from "../services/runningHub.service.js";
import { latestRunningHubVideo, runningHubFootageFile, runningHubGenerationCounts, runningHubVideoHistory, submitRunningHubVideo } from "../services/runningHubVideo.service.js";
import { planWorkflow, WorkflowId } from "../utils/runningHubWorkflow.js";
import { MAX_REFERENCE_AUDIO_BYTES, MAX_REFERENCE_AUDIOS, MAX_REFERENCE_IMAGE_BYTES, MAX_REFERENCE_IMAGES } from "../utils/videoClipInputs.js";

const multipartLimit = MAX_REFERENCE_IMAGES * MAX_REFERENCE_IMAGE_BYTES + MAX_REFERENCE_AUDIOS * MAX_REFERENCE_AUDIO_BYTES + 1_000_000;
const SetupBody = z.object({
  apiKey: z.string().trim().min(1).max(500).regex(/^[\x21-\x7E]+$/).optional(),
  workflowId: WorkflowId,
});

function respondError(reply: FastifyReply, error: unknown) {
  if (error instanceof RunningHubError || error instanceof ProjectActivityError) return reply.code(error.statusCode).send({ error: error.message });
  throw error;
}

export async function runningHubRoutes(app: FastifyInstance) {
  app.addContentTypeParser(/^multipart\/form-data\b/i, { parseAs: "buffer", bodyLimit: multipartLimit }, (_req, body, done) => done(null, body));
  app.addHook("onRequest", async (_req, reply) => { reply.header("Cache-Control", "no-store"); });

  app.get("/runninghub/settings", async () => publicRunningHubSettings(await readRunningHubSettings()));

  app.put("/runninghub/settings", async (req, reply) => {
    const body = SetupBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "กรุณาใส่ API Key และเลข Workflow ให้ถูกต้อง" });
    const saved = await readRunningHubSettings();
    const { workflowId, apiKey = saved.apiKey } = body.data;
    if (!apiKey) return reply.code(400).send({ error: "กรุณาใส่ RunningHub API Key" });
    if (workflowId === saved.workflowId && apiKey === saved.apiKey) return publicRunningHubSettings(saved);
    await RunningHubSettings.updateOne({ _id: "global" }, {
      $set: { workflowId, apiKey, connection: "untested" }, $unset: { connectionMessage: "" },
      $inc: { revision: 1 },
    }, { upsert: true });
    return publicRunningHubSettings(await readRunningHubSettings());
  });

  app.post("/runninghub/test", async (_req, reply) => {
    const settings = await readRunningHubSettings();
    if (!settings.apiKey || !settings.workflowId) return reply.code(409).send({ error: "กรุณาบันทึก API Key และ Workflow ID ก่อนทดสอบ" });
    let connection: "connected" | "failed" = "connected";
    let connectionMessage: string | undefined;
    try {
      const graph = await getRunningHubWorkflow(settings.apiKey, settings.workflowId);
      try {
        planWorkflow(graph);
      } catch (error) {
        connectionMessage = error instanceof Error ? error.message : "Workflow นี้ยังไม่รองรับการส่งอัตโนมัติ";
      }
    } catch (error) {
      if (!(error instanceof RunningHubError)) throw error;
      connection = "failed";
      connectionMessage = error.message;
    }
    const result = await RunningHubSettings.updateOne({
      _id: "global", workflowId: settings.workflowId, revision: settings.revision ?? { $exists: false },
    }, {
      $set: { connection, ...(connectionMessage && { connectionMessage }) },
      ...(!connectionMessage && { $unset: { connectionMessage: "" } }),
    });
    if (!result.matchedCount) return reply.code(409).send({ error: "การตั้งค่าเปลี่ยนแล้ว กรุณาทดสอบอีกครั้ง" });
    return publicRunningHubSettings({ ...settings, connection, connectionMessage });
  });

  app.get<{ Params: { sceneId: string; clipCode: string } }>("/scenes/:sceneId/clips/:clipCode/runninghub", async (req, reply) => {
    try {
      return { job: await latestRunningHubVideo(req.params.sceneId, req.params.clipCode) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get<{ Params: { sceneId: string; clipCode: string } }>("/scenes/:sceneId/clips/:clipCode/runninghub/history", async (req, reply) => {
    try {
      return { history: await runningHubVideoHistory(req.params.sceneId, req.params.clipCode) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get<{ Params: { episodeId: string } }>("/episodes/:episodeId/runninghub/counts", async (req, reply) => {
    try {
      return { counts: await runningHubGenerationCounts(req.params.episodeId) };
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.get<{ Params: { jobId: string; index: string } }>("/runninghub/jobs/:jobId/footage/:index", async (req, reply) => {
    try {
      const file = await runningHubFootageFile(req.params.jobId, Number(req.params.index));
      const { size } = await stat(file);
      return reply.header("Content-Type", "video/mp4").header("Content-Length", size).send(createReadStream(file));
    } catch (error) {
      return respondError(reply, error);
    }
  });

  app.post<{ Params: { sceneId: string; clipCode: string } }>("/scenes/:sceneId/clips/:clipCode/runninghub", {
    bodyLimit: multipartLimit,
  }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: "กรุณาแนบภาพอ้างอิงของคลิป" });
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(req.body), { headers: { "Content-Type": req.headers["content-type"] ?? "" } }).formData();
    } catch {
      return reply.code(400).send({ error: "อ่านไฟล์ภาพที่ส่งมาไม่สำเร็จ" });
    }
    try {
      const job = await submitRunningHubVideo(req.params.sceneId, req.params.clipCode, form);
      return reply.code(202).send({ job });
    } catch (error) {
      return respondError(reply, error);
    }
  });
}
