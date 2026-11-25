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
  audioDir: path.resolve(process.env.AUDIO_DIR ?? "./data/audio"),
  llm: (() => {
    const requestedProvider = process.env.LLM_PROVIDER;
    const provider = requestedProvider === "gemini" || requestedProvider === "deepseek" ? requestedProvider : "openai";
    const openai = {
      apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
      baseUrl: "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL?.trim() || "gpt-6.1-terra",
    };
    if (provider === "openai") {
      return { provider, ...openai, vision: { apiKey: openai.apiKey, model: openai.model } };
    }
    const isDeepSeek = provider === "deepseek";
    const geminiModel = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
    const geminiApiKey = process.env.GEMINI_API_KEY ?? (isDeepSeek ? "" : process.env.LLM_API_KEY ?? "");
    return {
      provider,
      apiKey: isDeepSeek
        ? (process.env.DEEPSEEK_API_KEY ?? process.env.LLM_API_KEY ?? "")
        : geminiApiKey,
      baseUrl: isDeepSeek
        ? (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/v1")
        : (process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta"),
      model: isDeepSeek
        ? (process.env.DEEPSEEK_MODEL ?? "deepseek-chat")
        : geminiModel,
      vision: { apiKey: geminiApiKey, model: geminiModel },
    };
  })(),
  rh: {
    baseUrl: process.env.RH_BASE_URL ?? "https://www.runninghub.ai",
    apiKey: process.env.RH_API_KEY ?? "",
    maxConcurrentImage: parseInt(process.env.RH_MAX_CONCURRENT_IMAGE ?? "2", 10),
    maxConcurrentVideo: parseInt(process.env.RH_MAX_CONCURRENT_VIDEO ?? "1", 10),
  },
  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY ?? "",
  },
  ffmpegPath: process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg",
};

export function requireApiKeys() {
  if (!config.llm.apiKey) throw new Error("LLM_API_KEY is not set");
}
