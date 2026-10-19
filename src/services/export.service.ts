import { Types } from "mongoose";
import fs from "fs";
import path from "path";
import { config } from "../config/index.js";
import { Episode } from "../models/Episode.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";

type ClipDoc = {
  clipCode: string;
  startOffsetSec: number;
  durationSec: number;
  videoPrompt: string;
  promptVersion: number;
};

type ShotDoc = {
  _id: Types.ObjectId;
  sceneId: Types.ObjectId;
  shotCode: string;
  shotType: string;
  camera?: string;
  durationSec: number;
  action?: string;
  emotion?: string;
  narration?: string | null;
  sfx?: string;
  music?: string;
  dialogue: Array<{ source: string; speakerId?: Types.ObjectId; lineTh?: string; tone?: string }>;
  prompts?: { video?: string; image?: string; voice?: Array<{ speakerId?: Types.ObjectId; text?: string }> };
};

type SceneDoc = {
  _id: Types.ObjectId;
  sceneCode: string;
  title?: string;
  summary?: string;
  mood?: string;
  timeOfDay?: string;
  estDurationSec?: number;
  totalDurationSec?: number;
  clips: ClipDoc[];
};

export async function exportEpisode(
  projectId: string,
  episodeId: string,
  format: "json" | "md" | "csv"
): Promise<string> {
  const episode = await Episode.findById(episodeId).lean();
  if (!episode) throw new Error("Episode not found");

  const [characters, locations, scenes] = await Promise.all([
    Character.find({ projectId }).lean(),
    Location.find({ projectId }).lean(),
    Scene.find({ episodeId }).sort({ order: 1 }).lean() as unknown as Promise<SceneDoc[]>,
  ]);

  const charNameMap = new Map(
    (characters as unknown as Array<{ _id: Types.ObjectId; name: string }>).map((c) => [c._id.toString(), c.name])
  );

  const sceneIds = scenes.map((s) => s._id);
  const shots = await Shot.find({ sceneId: { $in: sceneIds } })
    .sort({ sceneId: 1, order: 1 })
    .lean() as unknown as ShotDoc[];

  const epCode = `EP${String(episode.number).padStart(2, "0")}`;
  const exportDir = path.join(config.dataDir, "exports", projectId, epCode);
  fs.mkdirSync(exportDir, { recursive: true });

  // ---- JSON ----
  if (format === "json") {
    const data = { episode, characters, locations, scenes, shots };
    const filePath = path.join(exportDir, "export.json");
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    return filePath;
  }

  // ---- Markdown ----
  if (format === "md") {
    const lines: string[] = [`# ${epCode}: ${episode.title}\n`];

    for (const scene of scenes) {
      lines.push(`## ${scene.sceneCode} — ${scene.title ?? ""}`);
      if (scene.summary) lines.push(`> ${scene.summary}`);
      if (scene.mood || scene.timeOfDay) {
        lines.push(`> อารมณ์: ${scene.mood ?? ""} | เวลา: ${scene.timeOfDay ?? ""} | ความยาว: ${scene.totalDurationSec ?? scene.estDurationSec ?? 0}s`);
      }
      lines.push("");

      // Shot list
      const sceneShots = shots.filter((sh) => sh.sceneId.toString() === scene._id.toString());
      if (sceneShots.length > 0) {
        lines.push("### Shot List\n");
        for (const sh of sceneShots) {
          lines.push(`#### ${sh.shotCode} [${sh.shotType}] ${sh.durationSec}s`);
          if (sh.camera) lines.push(`- กล้อง: ${sh.camera}`);
          if (sh.action) lines.push(`- การกระทำ: ${sh.action}`);
          if (sh.emotion) lines.push(`- อารมณ์: ${sh.emotion}`);
          if (sh.narration) lines.push(`- Narration: ${sh.narration}`);
          for (const d of sh.dialogue) {
            const speaker = charNameMap.get(d.speakerId?.toString() ?? "") ?? d.speakerId ?? "?";
            const tag = d.source === "generated" ? " *(AI)*" : "";
            const tone = d.tone ? ` [${d.tone}]` : "";
            lines.push(`> **${speaker}**${tone}: ${d.lineTh}${tag}`);
          }
          if (sh.prompts?.video) {
            lines.push(`\n**[Video Prompt]**\n\`\`\`\n${sh.prompts.video}\n\`\`\``);
          }
          if (sh.prompts?.image) {
            lines.push(`\n**[Image Prompt]**\n\`\`\`\n${sh.prompts.image}\n\`\`\``);
          }
          if (sh.prompts?.voice && sh.prompts.voice.length > 0) {
            lines.push("\n**[Voice Prompts]**");
            for (const v of sh.prompts.voice) {
              const speaker = charNameMap.get(v.speakerId?.toString() ?? "") ?? "?";
              lines.push(`- ${speaker}: ${v.text ?? ""}`);
            }
          }
          lines.push("");
        }
      }

      // Clip video prompts (S4)
      if (scene.clips && scene.clips.length > 0) {
        lines.push("### Video Prompts (Clips)\n");
        for (const clip of scene.clips) {
          lines.push(`#### ${clip.clipCode} [${clip.durationSec}s] (v${clip.promptVersion})`);
          if (clip.videoPrompt) {
            lines.push(`\`\`\`\n${clip.videoPrompt}\n\`\`\``);
          } else {
            lines.push("_(ยังไม่มี prompt — รัน Generate Prompt ก่อน)_");
          }
          lines.push("");
        }
      }

      lines.push("---\n");
    }

    const filePath = path.join(exportDir, "export.md");
    fs.writeFileSync(filePath, lines.join("\n"), "utf-8");
    return filePath;
  }

  // ---- CSV ----
  const rows = ["sceneCode,shotCode,shotType,durationSec,action,dialogueCount,generatedDialogue,hasVideoPrompt,hasImagePrompt,clipCount"];
  for (const scene of scenes) {
    const sceneShots = shots.filter((sh) => sh.sceneId.toString() === scene._id.toString());
    const clipCount = scene.clips?.length ?? 0;
    for (const sh of sceneShots) {
      const genCount = sh.dialogue.filter((d) => d.source === "generated").length;
      const hasVideo = sh.prompts?.video ? 1 : 0;
      const hasImage = sh.prompts?.image ? 1 : 0;
      rows.push([
        scene.sceneCode,
        sh.shotCode,
        sh.shotType,
        sh.durationSec,
        `"${(sh.action ?? "").replace(/"/g, '""')}"`,
        sh.dialogue.length,
        genCount,
        hasVideo,
        hasImage,
        clipCount,
      ].join(","));
    }
  }
  const filePath = path.join(exportDir, "shots.csv");
  fs.writeFileSync(filePath, rows.join("\n"), "utf-8");
  return filePath;
}
