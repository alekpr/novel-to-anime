import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { Types } from "mongoose";
import { config } from "../config/index.js";
import { Asset } from "../models/Asset.js";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { GenerationTask } from "../models/GenerationTask.js";
import { Job } from "../models/Job.js";
import { Location } from "../models/Location.js";
import { Project } from "../models/Project.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { Workflow } from "../models/Workflow.js";

const deletingProjects = new Set<string>();
const activeOperations = new Map<string, number>();

export class ProjectActivityError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

export async function holdProjectActivity(projectId: string): Promise<() => void> {
  const key = projectId.toLowerCase();
  if (deletingProjects.has(key)) throw new ProjectActivityError(409, "โปรเจกต์กำลังถูกลบ");

  activeOperations.set(key, (activeOperations.get(key) ?? 0) + 1);
  const release = () => {
    const remaining = (activeOperations.get(key) ?? 1) - 1;
    if (remaining === 0) activeOperations.delete(key);
    else activeOperations.set(key, remaining);
  };
  try {
    const project = await Project.findById(projectId).select("deletionPending").lean();
    if (!project) throw new ProjectActivityError(404, "ไม่พบโปรเจกต์");
    if (project.deletionPending) throw new ProjectActivityError(409, "โปรเจกต์อยู่ระหว่างการลบ");
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

export async function withProjectActivity<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
  const release = await holdProjectActivity(projectId);
  try {
    return await operation();
  } finally {
    release();
  }
}

function ignoreMissing(error: NodeJS.ErrnoException) {
  if (error.code !== "ENOENT") throw error;
}

async function removeProjectFiles(key: string): Promise<void> {
  const dataRoot = await realpath(config.dataDir).catch(ignoreMissing);
  if (!dataRoot) return;

  const projectDirectories: string[] = [];
  for (const folder of ["assets", "exports"]) {
    const directory = path.join(dataRoot, folder);
    const stats = await lstat(directory).catch(ignoreMissing);
    if (!stats) continue;
    if (!stats.isDirectory()) throw new Error(`Expected an app storage directory at ${directory}`);
    projectDirectories.push(path.join(directory, key));
  }
  for (const directory of projectDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function deleteProjectData(projectId: Types.ObjectId): Promise<void> {
  const key = projectId.toHexString();
  if (deletingProjects.has(key)) throw new ProjectActivityError(409, "โปรเจกต์กำลังถูกลบ");
  if (activeOperations.has(key)) {
    throw new ProjectActivityError(409, "โปรเจกต์นี้ยังมีงานกำลังทำอยู่ รอให้งานจบแล้วลบอีกครั้ง");
  }
  deletingProjects.add(key);
  try {
    const project = await Project.updateOne({ _id: projectId }, { $set: { deletionPending: true } });
    if (!project.matchedCount) throw new ProjectActivityError(404, "ไม่พบโปรเจกต์");

    const episodeIds = await Episode.distinct("_id", { projectId });
    const sceneFilter = { $or: [{ projectId }, { episodeId: { $in: episodeIds } }] };
    const sceneIds = await Scene.distinct("_id", sceneFilter);

    await removeProjectFiles(key);
    // Keep the parent records until dependent records are gone so a retry can still find them.
    await Shot.deleteMany({ $or: [{ episodeId: { $in: episodeIds } }, { sceneId: { $in: sceneIds } }] });
    await Asset.deleteMany({ projectId });
    await GenerationTask.deleteMany({ projectId });
    await Job.deleteMany({ projectId });
    await Workflow.deleteMany({ projectId });
    await Character.deleteMany({ projectId });
    await Location.deleteMany({ projectId });
    await Scene.deleteMany(sceneFilter);
    await Episode.deleteMany({ projectId });
    await Project.deleteOne({ _id: projectId });
  } finally {
    deletingProjects.delete(key);
  }
}
