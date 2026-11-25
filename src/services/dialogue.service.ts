import { isObjectIdOrHexString, Types } from "mongoose";
import { callText } from "../llm/client.js";
import { Character } from "../models/Character.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";

type PopulatedShot = {
  order: number;
  durationSec: number;
  dialogue: { speakerId?: { _id: Types.ObjectId; name: string } | null; lineTh?: string; tone?: string }[];
};

type VoiceChar = {
  _id: Types.ObjectId;
  name: string;
  voice?: {
    gender?: string; pitch?: string; defaultEmotion?: string;
    speechHabits?: string[]; voicePrompt?: string;
    audioLines?: { tag: string; line: string }[];
  };
};

export async function generateDialogueScript(sceneId: string): Promise<string> {
  if (!isObjectIdOrHexString(sceneId)) throw new Error("ไม่พบซีน");
  const scene = await Scene.findById(sceneId).lean() as any;
  if (!scene) throw new Error("ไม่พบซีน");

  const shots = await Shot.find({ sceneId })
    .sort({ order: 1 })
    .populate("dialogue.speakerId", "name")
    .lean() as unknown as PopulatedShot[];

  // collect lines with timing
  let cursor = 0;
  const lines: { shotNum: number; startSec: number; endSec: number; speakerName: string; speakerId: string; text: string; tone?: string }[] = [];
  const speakerIds = new Set<string>();

  for (const shot of shots) {
    const start = +cursor.toFixed(3);
    const end = +(cursor + shot.durationSec).toFixed(3);
    cursor = end;
    for (const d of shot.dialogue) {
      if (!d.lineTh?.trim()) continue;
      const name = (d.speakerId as any)?.name ?? "Unknown";
      const id = (d.speakerId as any)?._id?.toString() ?? "";
      if (id) speakerIds.add(id);
      lines.push({ shotNum: shot.order, startSec: start, endSec: end, speakerName: name, speakerId: id, text: d.lineTh.trim(), tone: d.tone });
    }
  }

  if (!lines.length) throw new Error("ไม่มีบทสนทนาในซีนนี้");

  // fetch voice profiles
  const chars = await Character.find(
    { _id: { $in: [...speakerIds].filter(Boolean).map(id => new Types.ObjectId(id)) } },
    { name: 1, "voice.gender": 1, "voice.pitch": 1, "voice.defaultEmotion": 1, "voice.speechHabits": 1, "voice.voicePrompt": 1, "voice.audioLines": 1 }
  ).lean() as unknown as VoiceChar[];

  const voiceMap = new Map(chars.map(c => [c.name, c.voice]));

  // build speaker profile block for LLM context
  const speakers = [...new Set(lines.map(l => l.speakerName))];
  const profileBlock = speakers.map(name => {
    const v = voiceMap.get(name);
    if (!v) return `${name}: no voice profile`;
    const tags = v.audioLines?.map(a => `[${a.tag}] example: "${a.line}"`).join("\n    ") ?? "none";
    return [
      `${name}:`,
      v.voicePrompt && `  voice style: ${v.voicePrompt}`,
      v.gender && `  gender: ${v.gender}`,
      v.pitch && `  pitch: ${v.pitch}`,
      v.defaultEmotion && `  default emotion: ${v.defaultEmotion}`,
      v.speechHabits?.length && `  speech habits: ${v.speechHabits.join(", ")}`,
      `  available emotion tags:\n    ${tags}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  // build dialogue input for LLM
  const dialogueBlock = lines.map(l => {
    const v = voiceMap.get(l.speakerName);
    const availTags = v?.audioLines?.map(a => a.tag) ?? [];
    const tagHint = availTags.length ? ` [available: ${availTags.join(", ")}]` : " [no tags — infer from tone]";
    return `[Shot ${l.shotNum}] ${l.startSec.toFixed(1)}s–${l.endSec.toFixed(1)}s | ${l.speakerName}${l.tone ? ` (tone: ${l.tone})` : ""}${tagHint}\n"${l.text}"`;
  }).join("\n\n");

  const userPrompt = `Scene: ${scene.sceneCode} — ${scene.title}
Mood: ${scene.mood ?? ""}

## Speaker Voice Profiles
${profileBlock}

## Dialogue Lines (shot order)
${dialogueBlock}`;

  const system = `You are an ElevenLabs voice production specialist for Thai short-form drama.

Your job: produce a **ready-to-paste ElevenLabs script** where every line already has emotion tags embedded inline. The user will copy each speaker's block directly into ElevenLabs Studio.

## Output structure

For each speaker, output one block:

───────────────────────────────
## [Speaker Name]
Voice direction: <1 sentence describing overall delivery for this scene>
Stability: <0.0–1.0> | Similarity: <0.0–1.0> | Style: <0.0–1.0>

### Ready-to-use script (copy this into ElevenLabs):
\`\`\`
<line 1 with tags embedded>
<line 2 with tags embedded>
\`\`\`
───────────────────────────────

## Tag rules (CRITICAL)
- Embed tags DIRECTLY inside the Thai text using this format: [tag]text[/tag]
- Use ONLY tags listed under "available emotion tags" for that speaker
- If no tags available, use ElevenLabs built-in tags: [angry], [sad], [happy], [fearful], [disgusted], [surprised], [calm], [excited], [whisper]
- For pauses use: <break time="0.3s" /> (adjust duration to match shot timing)
- For emphasis use: <emphasis level="strong">word</emphasis>
- Wrap the ENTIRE line including tags — do not leave any Thai text outside tags
- Each line = one \`<break>\` at the end matching the gap to the next line in the same shot

## Example output format:
\`\`\`
[calm]เจ้าแน่ใจหรือว่าจะเข้าไป[/calm]<break time="0.5s" />
[fearful]ข้าไม่แน่ใจ... แต่ไม่มีทางเลือก[/fearful]<break time="0.8s" />
\`\`\`

## Rules
- Never alter Thai text — copy verbatim, only wrap with tags
- Each speaker gets their own separate block
- Order lines chronologically by shot number
- Add shot reference as a comment above each line: // Shot N (Xs–Xs)
- Output in English for all labels/directions, Thai only inside the script blocks`;

  const raw = await callText({ system, user: userPrompt, temperature: 0.3, maxTokens: 4000 });
  await Scene.findByIdAndUpdate(sceneId, { $set: { dialogueScript: raw } });
  return raw;
}

export async function getDialogueScript(sceneId: string): Promise<string | null> {
  if (!isObjectIdOrHexString(sceneId)) throw new Error("ไม่พบซีน");
  const scene = await Scene.findById(sceneId).select("dialogueScript").lean() as any;
  return scene?.dialogueScript ?? null;
}
