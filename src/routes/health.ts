import { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { z } from "zod";
import { config } from "../config/index.js";
import { callStructured, LLMRequestError } from "../llm/client.js";
import { readRunningHubSettings } from "../services/runningHub.service.js";

const connectionCheck = z.object({ ok: z.literal(true) });

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const mongoOk = mongoose.connection.readyState === 1;
    const llmKeyOk = config.llm.apiKey.length > 0;
    const rhKeyOk = mongoOk ? !!(await readRunningHubSettings()).apiKey : !!config.rh.apiKey;

    return {
      status: mongoOk ? "ok" : "degraded",
      mongo: mongoOk ? "connected" : "disconnected",
      llmKey: llmKeyOk ? "set" : "missing",
      rhKey: rhKeyOk ? "set" : "missing",
    };
  });

  app.get("/settings", async () => {
    const rhKeySet = mongoose.connection.readyState === 1 ? !!(await readRunningHubSettings()).apiKey : !!config.rh.apiKey;
    return {
      llmProvider: config.llm.provider,
      llmModel: config.llm.model,
      llmBaseUrl: config.llm.baseUrl,
      llmKeySet: config.llm.apiKey.length > 0,
      rhBaseUrl: config.rh.baseUrl,
      rhKeySet,
      rhKeyPreview: rhKeySet ? "บันทึกแล้ว" : "",
      dataDir: config.dataDir,
      maxConcurrentImage: config.rh.maxConcurrentImage,
      maxConcurrentVideo: config.rh.maxConcurrentVideo,
    };
  });

  app.post("/settings/llm/test", async (_req, reply) => {
    try {
      await callStructured({
        system: "This is an API connection check. Return JSON only.",
        user: 'Return exactly {"ok":true}.',
        schema: connectionCheck,
        maxTokens: 2048,
        maxRetries: 0,
      });
      return { connected: true, model: config.llm.model };
    } catch (error) {
      if (error instanceof LLMRequestError) {
        const message = error.status === 422 ? "โมเดลไม่ตอบผลทดสอบการเชื่อมต่อ" : error.message;
        return reply.code(error.status === 429 ? 429 : 502).send({ error: message });
      }
      return reply.code(502).send({ error: "ทดสอบ AI ไม่สำเร็จ กรุณาตรวจการตั้งค่า API Key และโมเดล" });
    }
  });
}
