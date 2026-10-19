import { Types } from "mongoose";
import { Episode } from "../models/Episode.js";
import { Character } from "../models/Character.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";

export type QAIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  ref?: { type: string; id: string; code?: string };
};

export type QAReport = {
  episodeId: string;
  passedChecks: number;
  totalChecks: number;
  issues: QAIssue[];
  passed: boolean;
  summary: { errors: number; warnings: number; info: number };
};

export async function runQA(projectId: string, episodeId: string): Promise<QAReport> {
  const issues: QAIssue[] = [];
  let totalChecks = 0;

  const episode = await Episode.findById(episodeId).lean();
  if (!episode) throw new Error("Episode not found");

  const characters = await Character.find({ projectId }).lean() as unknown as Array<{
    _id: Types.ObjectId; name: string; status: string;
    voice?: { gender?: string; voicePrompt?: string };
    appearanceBlock?: string;
  }>;
  const charMap = new Map(characters.map((c) => [c._id.toString(), c]));

  const scenes = await Scene.find({ episodeId }).sort({ order: 1 }).lean() as unknown as Array<{
    _id: Types.ObjectId; sceneCode: string; characterIds?: Types.ObjectId[];
  }>;

  const shots = await Shot.find({ episodeId }).lean() as unknown as Array<{
    _id: Types.ObjectId; sceneId: Types.ObjectId; shotCode: string;
    characterIds?: Types.ObjectId[];
    dialogue?: Array<{ speakerId?: Types.ObjectId; source: string; reviewed: boolean; lineTh?: string }>;
    prompts?: { video?: string; image?: string };
  }>;

  // ---- Check 1: ตัวละครทุกตัวใน shot ต้องอยู่ใน scene ----
  for (const shot of shots) {
    totalChecks++;
    const scene = scenes.find((s) => s._id.toString() === shot.sceneId.toString());
    if (!scene) {
      issues.push({ severity: "error", code: "SHOT_NO_SCENE", message: `Shot ${shot.shotCode} ไม่มี scene`, ref: { type: "shot", id: shot._id.toString(), code: shot.shotCode } });
      continue;
    }
    const sceneCharIds = new Set((scene.characterIds ?? []).map((id) => id.toString()));
    for (const cid of shot.characterIds ?? []) {
      if (!sceneCharIds.has(cid.toString())) {
        const char = charMap.get(cid.toString());
        issues.push({
          severity: "error",
          code: "CHAR_NOT_IN_SCENE",
          message: `ตัวละคร "${char?.name ?? cid}" ใน ${shot.shotCode} ไม่ได้อยู่ใน scene ${scene.sceneCode}`,
          ref: { type: "shot", id: shot._id.toString(), code: shot.shotCode },
        });
      }
    }
  }

  // ---- Check 2: dialogue ที่ generated และยังไม่ reviewed ----
  totalChecks++;
  const unreviewed = shots.flatMap((sh) =>
    (sh.dialogue ?? [])
      .filter((d) => d.source === "generated" && !d.reviewed)
      .map((d) => ({ shotCode: sh.shotCode, shotId: sh._id.toString(), line: d.lineTh ?? "" }))
  );
  if (unreviewed.length > 0) {
    issues.push({
      severity: "warning",
      code: "UNREVIEWED_DIALOGUE",
      message: `มีบทพูดที่ AI แต่งและยังไม่ตรวจ ${unreviewed.length} บรรทัด`,
      ref: { type: "episode", id: episodeId },
    });
  }

  // ---- Check 3: ทุก speaker ต้องมี voice profile ----
  totalChecks++;
  const speakerIds = new Set(
    shots.flatMap((sh) => (sh.dialogue ?? []).map((d) => d.speakerId?.toString()).filter(Boolean))
  );
  for (const sid of speakerIds) {
    const char = charMap.get(sid!);
    if (!char?.voice?.gender) {
      issues.push({
        severity: "warning",
        code: "MISSING_VOICE_PROFILE",
        message: `ตัวละคร "${char?.name ?? sid}" มีบทพูดแต่ไม่มี voice profile`,
        ref: { type: "character", id: sid! },
      });
    }
  }

  // ---- Check 4: ตัวละครที่ approved ต้องมี appearanceBlock ----
  totalChecks++;
  for (const char of characters) {
    if (char.status === "approved" && !char.appearanceBlock) {
      issues.push({
        severity: "error",
        code: "MISSING_APPEARANCE_BLOCK",
        message: `ตัวละคร "${char.name}" approved แล้วแต่ไม่มี appearanceBlock`,
        ref: { type: "character", id: char._id.toString() },
      });
    }
  }

  // ---- Check 5: ผลรวม durationSec ของ shots ต่อ scene ใกล้เคียง estDurationSec ----
  const scenesWithEst = await Scene.find({ episodeId }).lean() as unknown as Array<{
    _id: Types.ObjectId; sceneCode: string; estDurationSec?: number; totalDurationSec?: number;
  }>;
  for (const scene of scenesWithEst) {
    totalChecks++;
    const est = scene.estDurationSec ?? 0;
    const actual = scene.totalDurationSec ?? 0;
    if (est > 0 && Math.abs(actual - est) > est * 0.5) {
      issues.push({
        severity: "warning",
        code: "DURATION_MISMATCH",
        message: `Scene ${scene.sceneCode}: ความยาวจริง ${actual}s ต่างจากประมาณ ${est}s มากกว่า 50%`,
        ref: { type: "scene", id: scene._id.toString(), code: scene.sceneCode },
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warning").length;
  const passedChecks = totalChecks - errorCount;

  return {
    episodeId,
    passedChecks,
    totalChecks,
    issues,
    passed: errorCount === 0,
    summary: { errors: errorCount, warnings: warnCount, info: 0 },
  };
}
