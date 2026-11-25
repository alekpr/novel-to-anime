import { isObjectIdOrHexString } from "mongoose";
import { callStructured } from "../llm/client.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { z } from "zod";

const MusicCueSchema = z.object({
  cueNumber: z.number().int(),
  title: z.string(),
  scenes: z.array(z.string()),          // sceneCode[]
  startSec: z.number(),
  endSec: z.number(),
  durationSec: z.number(),
  emotionalArc: z.string(),
  instrumentation: z.string(),
  tempo: z.string(),
  dynamics: z.string(),
  rationale: z.string(),                // ทำไมถึงรวม scenes เหล่านี้
  prompt: z.string(),                   // ready-to-use music generation prompt
});

export type MusicCue = z.infer<typeof MusicCueSchema>;

const AnalysisSchema = z.object({
  overallArc: z.string(),
  cues: z.array(MusicCueSchema),
});

export type EpisodeBgmAnalysis = z.infer<typeof AnalysisSchema> & { raw?: string };

export async function analyzeEpisodeBgm(episodeId: string): Promise<EpisodeBgmAnalysis> {
  if (!isObjectIdOrHexString(episodeId)) throw new Error("ไม่พบตอน");

  const scenes = await Scene.find({ episodeId })
    .sort({ order: 1 })
    .populate("locationId", "name")
    .lean() as any[];

  if (!scenes.length) throw new Error("ยังไม่มี scenes — รัน Scene Breakdown ก่อน");

  // build full episode shot timeline
  let episodeCursor = 0;
  const sceneBlocks: string[] = [];

  for (const scene of scenes) {
    const shots = await Shot.find({ sceneId: scene._id })
      .sort({ order: 1 })
      .populate("characterIds", "name")
      .lean() as any[];

    const sceneStart = episodeCursor;
    let sceneCursor = episodeCursor;

    const shotLines: string[] = [];
    for (const shot of shots) {
      const start = +sceneCursor.toFixed(1);
      const end = +(sceneCursor + shot.durationSec).toFixed(1);
      sceneCursor = end;
      const hasDialogue = shot.dialogue?.some((d: any) => d.lineTh?.trim());
      const chars = (shot.characterIds as any[]).map((c: any) => c.name).join(", ");
      shotLines.push(
        `  [Shot ${shot.order}] ${start}s–${end}s · ${shot.shotType}` +
        (chars ? ` · ${chars}` : "") +
        (shot.emotion ? ` · emotion: ${shot.emotion}` : "") +
        (hasDialogue ? " · HAS DIALOGUE" : "") +
        (shot.sfx ? ` · sfx: ${shot.sfx}` : "")
      );
    }

    episodeCursor = sceneCursor;
    const sceneEnd = episodeCursor;
    const loc = (scene.locationId as any)?.name ?? "";

    sceneBlocks.push(
      `[${scene.sceneCode}] ${sceneStart.toFixed(1)}s–${sceneEnd.toFixed(1)}s (${(sceneEnd - sceneStart).toFixed(1)}s)\n` +
      `  Title: ${scene.title}\n` +
      `  Mood: ${scene.mood ?? ""}\n` +
      (loc ? `  Location: ${loc}\n` : "") +
      (shotLines.length ? shotLines.join("\n") : "  (no shots yet)")
    );
  }

  const totalSec = +episodeCursor.toFixed(1);

  const userPrompt = `Episode total duration: ${totalSec}s · ${scenes.length} scenes

## Scene-by-Scene Timeline
${sceneBlocks.join("\n\n")}`;

  const system = `You are a professional music supervisor for Thai short-form drama (vertical video, 9:16).

Analyze the full episode timeline and design a complete music cue sheet. Group scenes that share emotional continuity into single music cues. A new cue starts when there is a significant emotional shift, location change, or dramatic beat change.

Rules:
- Aim for 2–6 cues per episode (not one per scene)
- Scenes with dialogue should have music ducked or absent — note this in dynamics
- Each cue prompt must be a self-contained text-to-music generation prompt (for Suno, Udio, or similar) — specific enough to generate directly
- prompt field: write in English, include genre, instruments, BPM range, key/mode, mood, energy arc, duration
- duration in prompt: add 10s padding to durationSec (e.g. durationSec=141 → write "duration ~151s") to allow fade-in/fade-out headroom for editing
- rationale: explain in 1–2 sentences why these scenes are grouped together
- All timing in seconds (float)

Return a single JSON object with EXACTLY these camelCase field names:
{
  "overallArc": "string",
  "cues": [
    {
      "cueNumber": 1,
      "title": "string",
      "scenes": ["S01"],
      "startSec": 0.0,
      "endSec": 45.0,
      "durationSec": 45.0,
      "emotionalArc": "string",
      "instrumentation": "string",
      "tempo": "string",
      "dynamics": "string",
      "rationale": "string",
      "prompt": "English text-to-music prompt"
    }
  ]
}`;

  const { data } = await callStructured({
    system,
    user: userPrompt,
    schema: AnalysisSchema,
    temperature: 0.3,
  });

  const result: EpisodeBgmAnalysis = { ...data };

  await Episode.findByIdAndUpdate(episodeId, {
    $set: { bgmAnalysis: result },
  });

  return result;
}

export async function getEpisodeBgmAnalysis(episodeId: string): Promise<EpisodeBgmAnalysis | null> {
  if (!isObjectIdOrHexString(episodeId)) throw new Error("ไม่พบตอน");
  const ep = await Episode.findById(episodeId).select("bgmAnalysis").lean() as any;
  return ep?.bgmAnalysis ?? null;
}
