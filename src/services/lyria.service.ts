import ffmpeg from "fluent-ffmpeg";
import fs from "fs";
import path from "path";
import { config } from "../config/index.js";

const MODEL = "lyria-3-pro-preview";
const DURATION_EPSILON = 0.15;
const FADE_OUT_SEC = 0.6;

function roundSec(v: number) { return Math.round(v * 10) / 10; }

function probeDuration(filePath: string): Promise<number> {
  return new Promise(resolve => {
    ffmpeg.ffprobe(filePath, (err, meta) => resolve(err ? 0 : (meta.format.duration ?? 0)));
  });
}

function runFFmpeg(setup: (cmd: ffmpeg.FfmpegCommand) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    setup(cmd);
    cmd.on("end", () => resolve()).on("error", (e: Error) => reject(new Error(`FFmpeg: ${e.message}`))).run();
  });
}

async function normalizeDuration(inputPath: string, outputPath: string, targetSec: number): Promise<number> {
  const actual = await probeDuration(inputPath);
  if (actual <= 0) return roundSec(targetSec);
  if (Math.abs(actual - targetSec) <= DURATION_EPSILON) return roundSec(actual);

  const fadeStart = Math.max(0, targetSec - FADE_OUT_SEC).toFixed(3);
  const fadeDur = Math.min(FADE_OUT_SEC, targetSec).toFixed(3);
  const filter = `afade=t=out:st=${fadeStart}:d=${fadeDur}`;

  if (actual > targetSec) {
    await runFFmpeg(cmd => cmd.input(inputPath).audioFilters(filter).duration(targetSec).output(outputPath));
  } else {
    await runFFmpeg(cmd => cmd.input(inputPath).inputOptions(["-stream_loop -1"]).audioFilters(filter).duration(targetSec).output(outputPath));
  }

  const normalized = await probeDuration(outputPath);
  return roundSec(normalized > 0 ? normalized : targetSec);
}

export interface LyriaResult {
  filename: string;
  url: string;
  requestedDurationSec: number;
  actualDurationSec: number;
}

export async function generateLyriaAudio(
  prompt: string,
  durationSec: number,
  outputDir: string,
  filename: string
): Promise<LyriaResult> {
  if (config.llm.provider !== "gemini" || !config.llm.apiKey) {
    throw new Error("Lyria ต้องใช้ LLM_PROVIDER=gemini และ GEMINI_API_KEY");
  }

  ffmpeg.setFfmpegPath(config.ffmpegPath);

  const targetSec = roundSec(durationSec);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${config.llm.apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}. No lyrics. ${targetSec} seconds.` }] }],
      generationConfig: { responseModalities: ["AUDIO"] },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Lyria API error ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }>;
  };

  const audioBase64 = json.candidates?.[0]?.content?.parts
    ?.find(p => p.inlineData?.mimeType?.startsWith("audio/"))
    ?.inlineData?.data ?? "";

  if (!audioBase64) throw new Error("Lyria ไม่ส่ง audio กลับมา");

  fs.mkdirSync(outputDir, { recursive: true });
  const rawPath = path.join(outputDir, filename);
  fs.writeFileSync(rawPath, Buffer.from(audioBase64, "base64"));

  const normalizedPath = rawPath.replace(".mp3", "_norm.mp3");
  const actualDurationSec = await normalizeDuration(rawPath, normalizedPath, targetSec);

  if (fs.existsSync(normalizedPath)) {
    fs.renameSync(normalizedPath, rawPath);
  }

  return { filename, url: `/api/audio/${filename}`, requestedDurationSec: targetSec, actualDurationSec };
}
