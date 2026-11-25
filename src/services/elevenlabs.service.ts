import { ElevenLabsClient } from "elevenlabs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isObjectIdOrHexString, Types } from "mongoose";
import { config } from "../config/index.js";
import { Character } from "../models/Character.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";

function client() {
  if (!config.elevenLabs.apiKey) throw new Error("กรุณาตั้งค่า ELEVENLABS_API_KEY ใน .env ก่อน");
  return new ElevenLabsClient({ apiKey: config.elevenLabs.apiKey });
}

export async function listElevenLabsVoices() {
  if (!config.elevenLabs.apiKey) throw new Error("กรุณาตั้งค่า ELEVENLABS_API_KEY ใน .env ก่อน");
  const el = new ElevenLabsClient({ apiKey: config.elevenLabs.apiKey });
  try {
    const res = await el.voices.getAll();
    return res.voices.map(v => ({
      voiceId: v.voice_id, name: v.name, category: v.category,
      previewUrl: v.preview_url, labels: v.labels,
    }));
  } catch (e: any) {
    // voices_read permission ไม่มี — return empty list แทน throw
    if (e?.statusCode === 401 || e?.status === 401) return [];
    throw e;
  }
}

export async function setCharacterVoiceId(characterId: string, voiceId: string) {
  if (!isObjectIdOrHexString(characterId)) throw new Error("ไม่พบตัวละคร");
  const char = await Character.findByIdAndUpdate(
    characterId,
    { $set: { "voice.elevenLabsVoiceId": voiceId || null } },
    { new: true }
  ).lean();
  if (!char) throw new Error("ไม่พบตัวละคร");
  return char;
}

type DialogueLine = {
  shotNum: number;
  startSec: number;
  endSec: number;
  speakerName: string;
  speakerId: string;
  voiceId: string;
  text: string;
  tone?: string;
  availableTags: string[];
};

export async function getSceneDialogueLines(sceneId: string): Promise<{
  lines: DialogueLine[];
  speakers: { name: string; voiceId: string | null; availableTags: string[] }[];
}> {
  if (!isObjectIdOrHexString(sceneId)) throw new Error("ไม่พบซีน");

  const shots = await Shot.find({ sceneId })
    .sort({ order: 1 })
    .populate("dialogue.speakerId", "name")
    .lean() as any[];

  let cursor = 0;
  const lines: DialogueLine[] = [];
  const speakerIds = new Set<string>();

  for (const shot of shots) {
    const start = +cursor.toFixed(3);
    const end = +(cursor + shot.durationSec).toFixed(3);
    cursor = end;
    for (const d of shot.dialogue ?? []) {
      if (!d.lineTh?.trim()) continue;
      const name = d.speakerId?.name ?? "Unknown";
      const id = d.speakerId?._id?.toString() ?? "";
      if (id) speakerIds.add(id);
      lines.push({ shotNum: shot.order, startSec: start, endSec: end, speakerName: name, speakerId: id, voiceId: "", text: d.lineTh.trim(), tone: d.tone, availableTags: [] });
    }
  }

  if (!lines.length) return { lines: [], speakers: [] };

  const chars = await Character.find(
    { _id: { $in: [...speakerIds].map(id => new Types.ObjectId(id)) } },
    { name: 1, "voice.elevenLabsVoiceId": 1, "voice.audioLines": 1 }
  ).lean() as any[];

  const charMap = new Map(chars.map((c: any) => [c.name, c.voice]));
  for (const line of lines) {
    const v = charMap.get(line.speakerName) as any;
    line.voiceId = v?.elevenLabsVoiceId ?? "";
    line.availableTags = (v?.audioLines ?? []).map((a: any) => a.tag);
  }

  const speakers = [...new Set(lines.map(l => l.speakerName))].map(name => {
    const v = charMap.get(name) as any;
    return { name, voiceId: v?.elevenLabsVoiceId ?? null, availableTags: (v?.audioLines ?? []).map((a: any) => a.tag) };
  });

  return { lines, speakers };
}

export async function generateSceneAudio(
  sceneId: string,
  dataDir: string,
  options?: { stability?: number; similarityBoost?: number; style?: number }
): Promise<{ speakerName: string; shotNum: number; text: string; filePath: string }[]> {
  if (!isObjectIdOrHexString(sceneId)) throw new Error("ไม่พบซีน");
  const el = client();
  const { lines } = await getSceneDialogueLines(sceneId);
  if (!lines.length) throw new Error("ไม่มีบทสนทนาในซีนนี้");

  const missing = lines.filter(l => !l.voiceId).map(l => l.speakerName);
  if (missing.length) throw new Error(`ตัวละครต่อไปนี้ยังไม่ได้ตั้ง ElevenLabs Voice ID: ${[...new Set(missing)].join(", ")}`);

  const outDir = path.join(dataDir, "assets", "elevenlabs", sceneId);
  await mkdir(outDir, { recursive: true });

  const results: { speakerName: string; shotNum: number; text: string; filePath: string }[] = [];

  for (const line of lines) {
    const filename = `shot${String(line.shotNum).padStart(3, "0")}-${line.speakerName.replace(/\s+/g, "_")}.mp3`;
    const filePath = path.join(outDir, filename);

    const stream = await el.textToSpeech.convert(line.voiceId, {
      text: line.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: options?.stability ?? 0.5,
        similarity_boost: options?.similarityBoost ?? 0.75,
        style: options?.style ?? 0.3,
        use_speaker_boost: true,
      },
    });

    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
    await writeFile(filePath, Buffer.concat(chunks));
    results.push({ speakerName: line.speakerName, shotNum: line.shotNum, text: line.text, filePath: `/api/elevenlabs/audio/${sceneId}/${filename}` });
  }

  return results;
}
