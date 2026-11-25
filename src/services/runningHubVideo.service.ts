import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import type { ReadableStream } from "node:stream/web";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { isObjectIdOrHexString, Types } from "mongoose";
import { config } from "../config/index.js";
import { GenerationTask } from "../models/GenerationTask.js";
import { Project } from "../models/Project.js";
import { Scene } from "../models/Scene.js";
import { withProjectActivity } from "./projectLifecycle.service.js";
import {
  createRunningHubTask, getRunningHubWorkflow, readRunningHubSettings, RunningHubError, runningHubTaskResult, uploadRunningHubImage,
} from "./runningHub.service.js";
import { planWorkflow } from "../utils/runningHubWorkflow.js";
import { supportedReferenceImage, validPictureSlots, videoDuration, videoRatio, supportedReferenceAudio, MAX_REFERENCE_AUDIOS } from "../utils/videoClipInputs.js";
import { isDramaClipDuration } from "../utils/shortDrama.js";
import { usesLatinVideoPrompt } from "../utils/videoPromptLanguage.js";

export const runningHubVideoKey = "runninghub-video";
type VideoScene = {
  _id: Types.ObjectId; episodeId: Types.ObjectId; projectId: Types.ObjectId; dramaBeat?: unknown; shotsApproved?: boolean;
  clips: { clipCode: string; videoPrompt: string; durationSec: number; promptVersion: number; stale?: boolean;
    referenceSlots?: { index: number; name: string }[] }[];
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const runMediaTool = promisify(execFile);
const generatedPrefix = "/generated-videos/";
const assetPath = (key: string) => path.join(config.dataDir, "assets", key);
const videoDirectory = (task: StoredTask) => `${task.projectId}/runninghub/${task._id}`;

async function getClip(sceneId: string, clipCode: string) {
  if (!isObjectIdOrHexString(sceneId)) throw new RunningHubError(404, "ไม่พบซีน");
  const scene = await Scene.findById(sceneId).select("episodeId projectId dramaBeat shotsApproved clips").lean<VideoScene>();
  const clip = scene?.clips.find(clip => clip.clipCode === clipCode);
  if (!scene || !clip) throw new RunningHubError(404, "ไม่พบคลิป");
  if (clip.stale || !clip.videoPrompt?.trim()) throw new RunningHubError(409, "กรุณาสร้างพรอมป์ล่าสุดในขั้น 6 ก่อน");
  const activeKey = `${sceneId.toLowerCase()}:${clipCode}`;
  const generationKey = digest(JSON.stringify([activeKey, clip.promptVersion, clip.videoPrompt, clip.durationSec, clip.referenceSlots]));
  return { scene, clip, activeKey, generationKey };
}

type StoredTask = InstanceType<typeof GenerationTask>;
function publicTask(task: StoredTask, notice?: string) {
  return {
    id: String(task._id), status: task.status, taskId: task.runninghubTaskId,
    error: task.error, notice,
    videos: task.outputs.flatMap(output => output.type === "video" && output.url ? [output.url] : []),
  };
}

function isFile(value: FormDataEntryValue | null): value is File {
  return !!value && typeof value !== "string";
}

async function validateReferenceFile(file: File) {
  if (!supportedReferenceImage(file.name, file.size)) return false;
  const header = Buffer.from(await file.slice(0, 12).arrayBuffer());
  if (/\.png$/i.test(file.name)) return header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (/\.webp$/i.test(file.name)) return header.subarray(0, 4).toString() === "RIFF" && header.subarray(8, 12).toString() === "WEBP";
  return header.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
}

export async function submitRunningHubVideo(sceneId: string, clipCode: string, form: FormData) {
  const { scene, clip, activeKey, generationKey } = await getClip(sceneId, clipCode);
  const projectId = String(scene.projectId);
  return withProjectActivity(projectId, async () => {
    if (String(clip.promptVersion) !== form.get("promptVersion")) throw new RunningHubError(409, "พรอมป์เปลี่ยนแล้ว กรุณาเปิดคลิปอีกครั้ง");
    // optimizedPrompt = H3 prompt จาก tab Optimizer (ถ้ามี) ใช้แทน clip.videoPrompt
    const optimizedPrompt = form.get("optimizedPrompt");
    const promptText = (typeof optimizedPrompt === "string" && optimizedPrompt.trim())
      ? optimizedPrompt.trim()
      : clip.videoPrompt;
    const isOptimized = promptText !== clip.videoPrompt;
    if (!usesLatinVideoPrompt(promptText)) {
      throw new RunningHubError(422, "พรอมป์นี้ยังมีข้อความนอกบทพูดที่เป็นภาษาอื่น กรุณาสร้างพรอมป์ใหม่ในขั้น 6");
    }
    if (!Number.isFinite(clip.durationSec) || clip.durationSec <= 0 ||
        (scene.dramaBeat && (!scene.shotsApproved || !isDramaClipDuration(clip.durationSec)))) {
      throw new RunningHubError(422, "กรุณาตรวจอนุมัติช็อตและความยาวที่ระบุในพรอมป์");
    }
    const declaredDuration = isOptimized ? undefined : videoDuration(promptText);
    if (declaredDuration !== undefined && declaredDuration !== clip.durationSec) {
      throw new RunningHubError(422, "ความยาวในพรอมป์ไม่ตรงกับคลิป กรุณาสร้างพรอมป์ใหม่");
    }
    const project = await Project.findById(scene.projectId).select("styleGuide.aspectRatio").lean();
    const projectRatio = project?.styleGuide?.aspectRatio;
    const ratio = projectRatio ?? videoRatio(promptText) ?? (scene.dramaBeat ? "9:16" : undefined);
    if (typeof ratio !== "string" || !/^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(ratio)) throw new RunningHubError(422, "พรอมป์ไม่มีสัดส่วนภาพที่ใช้ได้");
    const slots = (clip.referenceSlots ?? []).slice().sort((a, b) => a.index - b.index);
    if (!isOptimized && !validPictureSlots(promptText, slots)) {
      throw new RunningHubError(422, "กรุณาสร้างพรอมป์ที่มีลำดับ Picture ถูกต้องก่อนส่ง");
    }
    const files = slots.map(slot => form.get(`picture-${slot.index}`));
    if (!files.every(isFile)) throw new RunningHubError(422, "แนบภาพอ้างอิงให้ครบตามลำดับ Picture ก่อนส่ง");
    if (!(await Promise.all(files.map(validateReferenceFile))).every(Boolean)) {
      throw new RunningHubError(422, "ใช้ภาพ PNG, JPG หรือ WebP ขนาดไม่เกิน 10 MB ต่อภาพ");
    }
    // Audio references (optional, max 3)
    const audioEntries: { charId: string; file: File }[] = []
    for (const [key, value] of form.entries()) {
      if (/^audio-[a-f0-9]{24}$/i.test(key) && isFile(value)) audioEntries.push({ charId: key.slice(6), file: value })
    }
    if (audioEntries.length > MAX_REFERENCE_AUDIOS) throw new RunningHubError(422, `ส่ง audio อ้างอิงได้สูงสุด ${MAX_REFERENCE_AUDIOS} ไฟล์`);
    if (audioEntries.some(({ file }) => !supportedReferenceAudio(file.name, file.size))) {
      throw new RunningHubError(422, "ใช้ไฟล์เสียง MP3, WAV, M4A, AAC, OGG หรือ FLAC ขนาดไม่เกิน 20 MB ต่อไฟล์");
    }
    const settings = await readRunningHubSettings();
    if (!settings.apiKey || !settings.workflowId) throw new RunningHubError(409, "บันทึก API Key และ Workflow ID ก่อนส่ง");
    const task = await GenerationTask.create({
      projectId: scene.projectId, episodeId: scene.episodeId, target: { type: "scene", id: scene._id },
      workflowKey: runningHubVideoKey, runninghubWorkflowId: settings.workflowId, activeKey, generationKey,
      params: { clipCode, promptVersion: clip.promptVersion, credential: digest(settings.apiKey) },
      status: "queued", attempts: 1,
    }).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) {
        throw new RunningHubError(409, "คลิปนี้มีงานสร้างวิดีโอกำลังทำอยู่");
      }
      throw error;
    });

    let creating = false;
    try {
      const graph = await getRunningHubWorkflow(settings.apiKey, settings.workflowId);
      const request = planWorkflow(graph);
      const input = { prompt: promptText, ratio, duration: declaredDuration ?? clip.durationSec };
      request({ ...input, imagePaths: slots.map(() => "check") });
      const imagePaths: string[] = [];
      for (const file of files) imagePaths.push(await uploadRunningHubImage(settings.apiKey, file));
      const audioPaths: string[] = [];
      for (const { file } of audioEntries) audioPaths.push(await uploadRunningHubImage(settings.apiKey, file));
      if ((await getClip(sceneId, clipCode)).generationKey !== generationKey) {
        throw new RunningHubError(409, "พรอมป์เปลี่ยนระหว่างเตรียมภาพ กรุณาตรวจคลิปอีกครั้ง");
      }
      creating = true;
      const response = await createRunningHubTask(settings.apiKey, settings.workflowId, request({ ...input, imagePaths, audioPaths }));
      task.runninghubTaskId = response.taskId;
      task.status = response.taskStatus?.toUpperCase() === "RUNNING" ? "running" : "queued";
      task.startedAt = new Date();
      try {
        await task.save();
      } catch {
        await GenerationTask.updateOne({ _id: task._id }, { $set: {
          runninghubTaskId: task.runninghubTaskId, status: task.status, startedAt: task.startedAt,
        } });
      }
      return publicTask(task);
    } catch (error) {
      if (task.runninghubTaskId) throw new RunningHubError(502, `RunningHub รับงานแล้ว เลขงาน ${task.runninghubTaskId} แต่บันทึกในแอปไม่สำเร็จ`);
      const reason = error instanceof Error ? error.message : "ส่งงานไม่สำเร็จ";
      const message = creating && error instanceof RunningHubError && error.uncertain
        ? `${reason} กรุณาเช็กรายการงานใน RunningHub ก่อนส่งซ้ำ` : reason;
      await GenerationTask.updateOne({ _id: task._id }, {
        $set: { status: "failed", error: message, finishedAt: new Date() }, $unset: { activeKey: "" },
      });
      throw new RunningHubError(error instanceof RunningHubError ? error.statusCode : 422, message);
    }
  });
}

export async function runningHubVideoHistory(sceneId: string, clipCode: string) {
  if (!isObjectIdOrHexString(sceneId)) throw new RunningHubError(404, "ไม่พบซีน");
  const tasks = await GenerationTask.find({
    workflowKey: runningHubVideoKey,
    "target.type": "scene",
    "target.id": new Types.ObjectId(sceneId),
    "params.clipCode": clipCode,
    runninghubTaskId: { $type: "string", $ne: "" },
  }).select("status outputs params createdAt").sort({ createdAt: -1 }).lean();
  return tasks.map((task, i) => ({
    id: String(task._id),
    promptVersion: (task.params as any)?.promptVersion ?? 1,
    submitIndex: tasks.length - i,   // เรียงจากใหม่ไปเก่า → submit ล่าสุด = เลขสูงสุด
    status: task.status,
    videoCount: task.outputs.filter(o => o.type === "video" && o.url).length,
    createdAt: task.createdAt,
  }));
}

function validVideoOutput(output: { fileUrl: string; fileType?: string }) {
  try {
    const url = new URL(output.fileUrl);
    const formats = ["mp4", "webm", "mov"];
    const ext = [output.fileType?.toLowerCase().replace(/^video\//, ""), path.extname(url.pathname).slice(1).toLowerCase()]
      .find(value => value && formats.includes(value));
    if (ext && url.protocol === "https:" && !url.username && !url.password) return { url, ext };
  } catch {
    // Ignore malformed output URLs.
  }
}

async function saveVideo(url: URL, ext: string, task: StoredTask, index: number) {
  const trusted = /(^|\.)(runninghub\.ai|runninghub\.cn|xiaoyaoyou\.com)$/.test(url.hostname) ||
    /^rh-[a-z0-9-]+-images-1252422369\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(url.hostname);
  if (!trusted || url.port || url.protocol !== "https:" || url.username || url.password) return url.href;
  const key = `${videoDirectory(task)}/${index}.${ext}`;
  const destination = assetPath(key);
  const partial = `${destination}.partial`;
  try {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(90_000) });
    if (!response.ok || !response.body) return url.href;
    await mkdir(path.dirname(destination), { recursive: true });
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > 256_000_000) callback(new Error("Video exceeds local cache size"));
        else callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as ReadableStream), limit, createWriteStream(partial));
    await rename(partial, destination);
    return generatedPrefix + key;
  } catch {
    await rm(partial, { force: true }).catch(() => {});
    return url.href;
  }
}

async function storedVideoPath(task: StoredTask, index: number) {
  const output = task.outputs.filter(output => output.type === "video" && output.url)[index - 1];
  const stored = output?.url;
  if (!stored) throw new RunningHubError(404, "ไม่พบไฟล์วิดีโอของงานนี้");
  const expected = `${generatedPrefix}${videoDirectory(task)}/${index}.`;
  function localPath(url: string) {
    return url.startsWith(expected) && ["mp4", "webm", "mov"].includes(url.slice(expected.length))
      ? assetPath(url.slice(generatedPrefix.length)) : undefined;
  }
  const local = localPath(stored);
  if (local && (await stat(local).catch(() => undefined))?.isFile()) return local;
  const source = validVideoOutput({ fileUrl: output.sourceUrl || stored });
  if (source) {
    const url = await saveVideo(source.url, source.ext, task, index);
    const downloaded = localPath(url);
    if (downloaded) return downloaded;
  }
  throw new RunningHubError(502, "โหลดไฟล์วิดีโอจาก RunningHub ไม่สำเร็จ กรุณาลองบันทึกอีกครั้ง");
}

async function normalizeFootage(source: string, destination: string) {
  const partial = destination + ".partial.mp4";
  try {
    const file = await open(source, "r");
    const header = Buffer.alloc(12);
    try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
    if (header.toString("ascii", 4, 8) !== "ftyp" && header.readUInt32BE(0) !== 0x1a45dfa3) {
      throw new RunningHubError(502, "ไฟล์ที่ RunningHub ส่งกลับมาไม่ใช่วิดีโอที่อ่านได้");
    }
    const { stdout } = await runMediaTool("ffprobe", ["-v", "error", "-protocol_whitelist", "file,pipe",
      "-show_entries", "stream=codec_type,codec_name,pix_fmt", "-of", "json", source], { timeout: 30_000 });
    const { streams = [] } = JSON.parse(stdout) as { streams?: { codec_type: string; codec_name: string; pix_fmt?: string }[] };
    const video = streams.find(stream => stream.codec_type === "video");
    const audio = streams.find(stream => stream.codec_type === "audio");
    if (!video) throw new RunningHubError(502, "ไฟล์ของงานนี้ไม่มีภาพวิดีโอ");
    const videoOptions = video.codec_name === "h264" && video.pix_fmt === "yuv420p"
      ? ["-c:v", "copy"] : ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "20"];
    await runMediaTool("ffmpeg", [
      "-nostdin", "-y", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", source, "-map", "0:v:0", "-map", "0:a:0?",
      ...videoOptions, "-c:a", audio?.codec_name === "aac" ? "copy" : "aac",
      "-movflags", "+faststart", "-f", "mp4", partial,
    ], { timeout: 300_000 });
    await rename(partial, destination);
  } catch (error) {
    await rm(partial, { force: true }).catch(() => {});
    if (error instanceof RunningHubError) throw error;
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new RunningHubError(503, "แอปต้องใช้ FFmpeg และ FFprobe เพื่อเตรียมวิดีโอสำหรับเปิดเล่น");
    }
    throw new RunningHubError(502, "เตรียมไฟล์วิดีโอ MP4 สำหรับเล่นไม่สำเร็จ");
  }
}

const preparingFootage = new Map<string, Promise<string>>();
export async function runningHubFootageFile(jobId: string, index: number) {
  if (!isObjectIdOrHexString(jobId) || !Number.isSafeInteger(index) || index < 1) throw new RunningHubError(404, "ไม่พบไฟล์วิดีโอ");
  const task = await GenerationTask.findOne({ _id: jobId, workflowKey: runningHubVideoKey, status: "succeeded" });
  if (!task) throw new RunningHubError(404, "ไม่พบงานวิดีโอที่เสร็จแล้ว");
  const key = `${task._id}:${index}`;
  const existing = preparingFootage.get(key);
  if (existing) return existing;
  const work = withProjectActivity(String(task.projectId), async () => {
    const destination = assetPath(`${videoDirectory(task)}/footage-${index}.mp4`);
    if ((await stat(destination).catch(() => undefined))?.size) return destination;
    const source = await storedVideoPath(task, index);
    await mkdir(path.dirname(destination), { recursive: true });
    await normalizeFootage(source, destination);
    return destination;
  }).finally(() => preparingFootage.delete(key));
  preparingFootage.set(key, work);
  return work;
}

const refreshing = new Map<string, Promise<ReturnType<typeof publicTask>>>();
async function refreshTask(task: StoredTask) {
  try {
    return await withProjectActivity(String(task.projectId), async () => {
      const { apiKey } = await readRunningHubSettings();
      if (!apiKey || digest(apiKey) !== task.params?.credential) return publicTask(task, "ใช้ API Key เดิมเพื่อตรวจผลของงานนี้");
      const result = await runningHubTaskResult(apiKey, task.runninghubTaskId!);
      let status: StoredTask["status"] = result.status;
      let error: string | null = null;
      let outputs: { url: string; sourceUrl: string; type: string }[] = [];
      if (result.status === "succeeded") {
        const videos = result.outputs.map(validVideoOutput).filter(video => video !== undefined);
        outputs = await Promise.all(videos.map(async ({ url, ext }, i) => ({
          url: await saveVideo(url, ext, task, i + 1), sourceUrl: url.href, type: "video",
        })));
        if (!outputs.length) {
          status = "failed";
          error = "Workflow ทำงานเสร็จแต่ไม่มีไฟล์วิดีโอ MP4, WebM หรือ MOV";
        }
      } else if (result.status === "failed") error = "RunningHub แจ้งว่างานไม่สำเร็จ ตรวจรายละเอียดจากเลขงาน";
      const terminal = status === "succeeded" || status === "failed";
      const saved = await GenerationTask.findByIdAndUpdate(task._id, {
        $set: { status, error, outputs, ...(terminal && { finishedAt: new Date() }) },
        ...(terminal && { $unset: { activeKey: "" } }),
      }, { new: true });
      return publicTask(saved ?? task);
    });
  } catch (error) {
    return publicTask(task, error instanceof RunningHubError ? error.message : "ยังดึงสถานะวิดีโอไม่ได้ ระบบจะลองตรวจใหม่");
  }
}

export async function runningHubGenerationCounts(episodeId: string) {
  if (!isObjectIdOrHexString(episodeId)) throw new RunningHubError(404, "ไม่พบตอน");
  const counts = await GenerationTask.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: {
      episodeId: new Types.ObjectId(episodeId),
      workflowKey: runningHubVideoKey,
      "target.type": "scene",
      "target.id": { $type: "objectId" },
      runninghubTaskId: { $type: "string", $ne: "" },
    } },
    { $group: { _id: "$target.id", count: { $sum: 1 } } },
  ]);
  return Object.fromEntries(counts.map(({ _id, count }) => [String(_id), count]));
}

export async function latestRunningHubVideo(sceneId: string, clipCode: string) {
  const { generationKey, activeKey } = await getClip(sceneId, clipCode);
  const task = await GenerationTask.findOne({ workflowKey: runningHubVideoKey, $or: [{ generationKey }, { activeKey }] }).sort({ createdAt: -1 });
  if (!task) return null;
  if (!task.runninghubTaskId || (task.status !== "queued" && task.status !== "running")) {
    return task.generationKey === generationKey || task.activeKey ? publicTask(task) : null;
  }
  const id = String(task._id);
  const status = await (refreshing.get(id) ?? (() => {
    const job = refreshTask(task).finally(() => refreshing.delete(id));
    refreshing.set(id, job);
    return job;
  })());
  if (task.generationKey === generationKey) return status;
  return status.status === "queued" || status.status === "running"
    ? { ...status, videos: [], notice: status.notice || "คลิปนี้ยังมีงานจากพรอมป์เวอร์ชันก่อนกำลังทำอยู่" }
    : null;
}
