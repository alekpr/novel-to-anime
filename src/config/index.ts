import "dotenv/config";
import path from "path";

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: parseInt(process.env.PORT ?? "3000", 10),
  mongoUri: process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/novel_anime",
  dataDir: path.resolve(process.env.DATA_DIR ?? "./data"),
  llm: {
    provider: (process.env.LLM_PROVIDER ?? "gemini") as "gemini" | "deepseek",
    apiKey: process.env.LLM_API_KEY ?? "",
    baseUrl: process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta",
    model: process.env.LLM_MODEL ?? "gemini-2.5-flash",
    fallback: {
      apiKey: process.env.LLM_FALLBACK_API_KEY ?? "",
      baseUrl: process.env.LLM_FALLBACK_BASE_URL ?? "",
      model: process.env.LLM_FALLBACK_MODEL ?? "",
    },
  },
  rh: {
    baseUrl: process.env.RH_BASE_URL ?? "https://www.runninghub.ai",
    apiKey: process.env.RH_API_KEY ?? "",
    maxConcurrentImage: parseInt(process.env.RH_MAX_CONCURRENT_IMAGE ?? "2", 10),
    maxConcurrentVideo: parseInt(process.env.RH_MAX_CONCURRENT_VIDEO ?? "1", 10),
  },
};

export function requireApiKeys() {
  if (!config.llm.apiKey) throw new Error("LLM_API_KEY is not set");
}
