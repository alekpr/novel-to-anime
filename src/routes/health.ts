import { FastifyInstance } from "fastify";
import mongoose from "mongoose";
import { config } from "../config/index.js";

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    const mongoOk = mongoose.connection.readyState === 1;
    const llmKeyOk = config.llm.apiKey.length > 0;
    const rhKeyOk = config.rh.apiKey.length > 0;

    return {
      status: mongoOk ? "ok" : "degraded",
      mongo: mongoOk ? "connected" : "disconnected",
      llmKey: llmKeyOk ? "set" : "missing",
      rhKey: rhKeyOk ? "set" : "missing",
    };
  });

  app.get("/settings", async () => {
    return {
      llmModel: config.llm.model,
      llmKeySet: config.llm.apiKey.length > 0,
      llmKeyPreview: config.llm.apiKey ? `${config.llm.apiKey.slice(0, 8)}…` : "",
      rhBaseUrl: config.rh.baseUrl,
      rhKeySet: config.rh.apiKey.length > 0,
      rhKeyPreview: config.rh.apiKey ? `${config.rh.apiKey.slice(0, 8)}…` : "",
      dataDir: config.dataDir,
      maxConcurrentImage: config.rh.maxConcurrentImage,
      maxConcurrentVideo: config.rh.maxConcurrentVideo,
    };
  });
}
