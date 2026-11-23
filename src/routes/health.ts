import { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { config } from "../config/index.js";
import { readRunningHubSettings } from "../services/runningHub.service.js";

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
      llmKeyPreview: config.llm.apiKey ? `${config.llm.apiKey.slice(0, 8)}…` : "",
      rhBaseUrl: config.rh.baseUrl,
      rhKeySet,
      rhKeyPreview: rhKeySet ? "บันทึกแล้ว" : "",
      dataDir: config.dataDir,
      maxConcurrentImage: config.rh.maxConcurrentImage,
      maxConcurrentVideo: config.rh.maxConcurrentVideo,
    };
  });
}
