import { isObjectIdOrHexString, Types } from "mongoose";
import { callText } from "../llm/client.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";

type PopulatedShot = {
  _id: Types.ObjectId;
  order: number;
  shotCode: string;
  shotType: string;
  durationSec: number;
  action?: string;
  emotion?: string;
  sfx?: string;
  music?: string;
  dialogue: { lineTh?: string }[];
  characterIds: { name: string }[];
};

export async function generateBgmPrompt(sceneId: string): Promise<string> {
  if (!isObjectIdOrHexString(sceneId)) throw new Error("ไม่พบซีน");
  const scene = await Scene.findById(sceneId)
    .populate("locationId", "name")
    .lean() as any;
  if (!scene) throw new Error("ไม่พบซีน");

  const shots = await Shot.find({ sceneId })
    .sort({ order: 1 })
    .populate("characterIds", "name")
    .lean() as unknown as PopulatedShot[];

  if (!shots.length) throw new Error("ยังไม่มี shots — รัน Shot Breakdown ก่อน");

  // build shot timeline
  let cursor = 0;
  const shotLines = shots.map((shot, i) => {
    const start = cursor;
    const end = +(cursor + shot.durationSec).toFixed(3);
    cursor = end;
    const hasDialogue = shot.dialogue.some(d => d.lineTh?.trim());
    const chars = (shot.characterIds as { name: string }[]).map(c => c.name).join(", ");
    const parts = [
      `[Shot ${i + 1}] ${start.toFixed(1)}s–${end.toFixed(1)}s (${shot.durationSec}s) · ${shot.shotType}`,
      chars && `Characters: ${chars}`,
      shot.action && `Action: ${shot.action}`,
      shot.emotion && `Emotion: ${shot.emotion}`,
      hasDialogue && `Dialogue: yes`,
      shot.sfx && `SFX note: ${shot.sfx}`,
      shot.music && `Music note: ${shot.music}`,
    ].filter(Boolean);
    return parts.join(" · ");
  });

  const totalSec = +cursor.toFixed(3);
  const locationName = (scene.locationId as any)?.name ?? "unknown location";

  const userPrompt = `Scene: ${scene.sceneCode} — ${scene.title}
Location: ${locationName}
Mood: ${scene.mood ?? ""}
Total duration: ${totalSec}s

Shot timeline:
${shotLines.join("\n")}

---
Generate a detailed BGM & Sound Design prompt for this scene.`;

  const system = `You are a professional music supervisor and sound designer for Thai short-form drama.

Given a shot-by-shot timeline, output a BGM & Sound Design prompt with these sections:

## Scene Overview
One paragraph: overall mood, genre, emotional arc, recommended instrumentation and tempo.

## Shot-by-Shot Sound Design
For every shot, output exactly:
[Shot N] HH:MM:SS.mmm–HH:MM:SS.mmm
- BGM: <instrument/style, dynamic level, e.g. "sparse piano, pp, entering on beat 2">  or  "— (silence)" if no BGM
- SFX: <specific diegetic sounds, e.g. "door creak, footsteps on tile">  or  "— (ambient only)"
- Ambience: <room tone / environment, e.g. "quiet office hum, distant traffic">
- Transition: <how sound bridges to next shot, e.g. "fade out 0.5s" / "hard cut" / "music swells into next shot">

## Music Cue List
Markdown table: | Cue # | Start | End | Duration | Style | Dynamics | Notes |

## Production Notes
Key mixing notes: dialogue vs music balance, any stinger/hit points on specific actions, fade in/out at scene boundaries.

Rules:
- No non-diegetic BGM during dialogue shots unless specified — keep music under dialogue at -18 dB or lower
- All timecodes in HH:MM:SS.mmm format
- Be specific: name instruments, BPM range, key/mode if relevant
- Output in English`;

  const raw = await callText({ system, user: userPrompt, temperature: 0.3, maxTokens: 4000 });

  await Scene.findByIdAndUpdate(sceneId, { $set: { bgmPrompt: raw } });
  return raw;
}

export async function getBgmPrompt(sceneId: string): Promise<string | null> {
  if (!isObjectIdOrHexString(sceneId)) throw new Error("ไม่พบซีน");
  const scene = await Scene.findById(sceneId).select("bgmPrompt").lean() as any;
  return scene?.bgmPrompt ?? null;
}
