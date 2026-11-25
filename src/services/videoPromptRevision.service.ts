import { isObjectIdOrHexString } from "mongoose";
import type { Types } from "mongoose";
import { z } from "zod";
import { callStructured, LLMOutputValidationError, LLMRequestError } from "../llm/client.js";
import { GenerationTask } from "../models/GenerationTask.js";
import { Scene } from "../models/Scene.js";
import { usesLatinVideoPrompt, videoPromptStructure } from "../utils/videoPromptLanguage.js";
import { withProjectActivity } from "./projectLifecycle.service.js";
import { runningHubVideoKey } from "./runningHubVideo.service.js";

export const VideoPromptRevisionInput = z.object({
  comment: z.string().trim().min(1).max(2000),
  promptVersion: z.number().int().positive(),
  sourceJobId: z.string().regex(/^[a-f0-9]{24}$/i),
});

export class VideoPromptRevisionError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

type RevisionScene = {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  dramaBeat?: unknown;
  shotsApproved?: boolean;
  clips: { clipCode: string; videoPrompt?: string; promptVersion?: number; durationSec?: number; stale?: boolean }[];
};
type SourceVideo = {
  _id: Types.ObjectId;
  params?: { promptVersion?: number };
  outputs: { type?: string; url?: string }[];
};

export async function reviseVideoPrompt(sceneId: string, clipCode: string, input: z.infer<typeof VideoPromptRevisionInput>) {
  if (!isObjectIdOrHexString(sceneId)) throw new VideoPromptRevisionError(404, "ไม่พบซีนนี้");
  const scene = await Scene.findById(sceneId).select("projectId dramaBeat shotsApproved clips").lean<RevisionScene>();
  const clip = scene?.clips.find(clip => clip.clipCode === clipCode);
  if (!scene || !clip) throw new VideoPromptRevisionError(404, "ไม่พบคลิปนี้");
  if (clip.stale || !clip.videoPrompt?.trim() || (scene.dramaBeat && !scene.shotsApproved)) {
    throw new VideoPromptRevisionError(409, "กรุณาสร้าง Video Prompt ล่าสุดในขั้น 6 ก่อนปรับจากคอมเมนต์");
  }
  const original = clip.videoPrompt;
  const version = clip.promptVersion ?? 1;
  if (input.promptVersion !== version) throw new VideoPromptRevisionError(409, "พรอมป์เปลี่ยนแล้ว กรุณาตรวจเวอร์ชันล่าสุดแล้วลองอีกครั้ง");

  return withProjectActivity(String(scene.projectId), async () => {
    const jobFilter = { projectId: scene.projectId, workflowKey: runningHubVideoKey,
      "target.type": "scene", "target.id": scene._id, "params.clipCode": clipCode };
    const activeFilter = { ...jobFilter, status: { $in: ["queued", "running"] } };
    const source = await GenerationTask.findOne({
      ...jobFilter, _id: input.sourceJobId, status: "succeeded",
      outputs: { $elemMatch: { type: "video", url: /\S/ } },
    }).select("outputs params.promptVersion").lean<SourceVideo>();
    if (!source) throw new VideoPromptRevisionError(409, "ต้องมีวิดีโอที่สร้างเสร็จของคลิปนี้ก่อนส่งคอมเมนต์");
    if (await GenerationTask.exists(activeFilter)) {
      throw new VideoPromptRevisionError(409, "รอให้คลิปที่กำลังสร้างเสร็จก่อนปรับพรอมป์");
    }

    const structure = videoPromptStructure(original);
    const schema = z.object({ videoPrompt: z.string().trim().min(1).max(Math.max(30_000, original.length + 2000)) })
      .refine(({ videoPrompt }) => videoPrompt !== original.trim() &&
        usesLatinVideoPrompt(videoPrompt) && videoPromptStructure(videoPrompt) === structure &&
        !/^\s*Vocal direction\s*:/im.test(videoPrompt),
      "Write the entire prompt in English, preserving shot headings and timing, camera angles, lens and framing labels, picture and subject IDs, and the exact dialogue tags and their speakers. Put English voice cues beside the speaker.");
    let videoPrompt: string;
    try {
      const { data } = await callStructured({
        system: "Revise this production video prompt using the user's feedback. Write the entire result in idiomatic English, including headings, descriptions of reference images, outfits and locations, camera directions, performance, sound, and inline vocal delivery. Translate any non-English production text anywhere in the original, even in sections the feedback does not mention. Refer to people by subject number or use an English description. Only the dialogue within existing <d> tags stays in its original language. Copy each entire <d> block exactly with its assigned speaker and shot. Keep delivery cues immediately before their dialogue tags. Preserve duration, aspect ratio, reference identity and numbering, shot headings and timing, camera angle and lens/framing labels, speaker IDs, and the existing prompt format. Replace any standalone Vocal direction label with an inline English cue. Return JSON with the complete revised videoPrompt.",
        user: JSON.stringify({ currentPrompt: original, feedback: input.comment }),
        schema,
        temperature: 0.2,
        maxRetries: 1,
      });
      videoPrompt = data.videoPrompt;
    } catch (error) {
      if (error instanceof LLMOutputValidationError) {
        throw new VideoPromptRevisionError(422, "AI ยังปรับพรอมป์เป็นภาษาอังกฤษโดยรักษาบทพูด เวลา และภาพอ้างอิงเดิมไม่ได้ กรุณาลองอีกครั้ง");
      }
      if (error instanceof LLMRequestError && error.status === 429) throw new VideoPromptRevisionError(429, error.message);
      throw new VideoPromptRevisionError(502, "AI ปรับพรอมป์ไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
    if (await GenerationTask.exists(activeFilter)) {
      throw new VideoPromptRevisionError(409, "มีงานสร้างวิดีโอเริ่มขึ้นระหว่างปรับพรอมป์ กรุณารอให้งานเสร็จแล้วลองอีกครั้ง");
    }

    const promptRevision = {
      comment: input.comment,
      updatedAt: new Date(),
      sourceJobId: String(source._id),
      sourceVideoCount: source.outputs.filter(output => output.type === "video" && output.url).length,
      sourcePromptVersion: source.params?.promptVersion,
    };
    const promptVersion = version + 1;
    const saved = await Scene.updateOne({
      _id: scene._id, projectId: scene.projectId, ...(scene.dramaBeat ? { shotsApproved: true } : {}),
      clips: { $elemMatch: {
        clipCode, videoPrompt: original, promptVersion: clip.promptVersion ?? null,
        durationSec: clip.durationSec ?? null, stale: { $ne: true },
      } },
    }, { $set: { "clips.$.videoPrompt": videoPrompt, "clips.$.promptVersion": promptVersion, "clips.$.promptRevision": promptRevision } });
    if (!saved.matchedCount) throw new VideoPromptRevisionError(409, "พรอมป์เปลี่ยนระหว่างปรับ กรุณาตรวจเวอร์ชันล่าสุดแล้วลองอีกครั้ง");
    return { videoPrompt, promptVersion, promptRevision };
  });
}
