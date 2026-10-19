import { Job } from "../models/Job.js";
import { GenerationTask } from "../models/GenerationTask.js";
import pino from "pino";

const log = pino({ name: "resync" });

export async function resyncOnStartup(): Promise<void> {
  // LLM jobs ที่ค้างสถานะ running → interrupted
  const stuckJobs = await Job.find({ status: "running" });
  if (stuckJobs.length > 0) {
    await Job.updateMany({ status: "running" }, { $set: { status: "interrupted" } });
    log.warn({ count: stuckJobs.length }, "Marked stuck LLM jobs as interrupted");
  }

  // GenerationTask ที่ยังไม่จบ — ตรวจสถานะจาก RunningHub
  const pendingTasks = await GenerationTask.find({
    status: { $in: ["queued", "running"] },
  });

  if (pendingTasks.length === 0) return;

  log.info({ count: pendingTasks.length }, "Found pending generation tasks, will resync when RH client is ready");

  for (const task of pendingTasks) {
    if (!task.runninghubTaskId) {
      // ยังไม่ได้ส่งไป RunningHub → reset เป็น pending ให้ผู้ใช้ตัดสินใจ
      await task.updateOne({ status: "pending", error: "App restarted before task was submitted" });
    }
    // task ที่มี runninghubTaskId จะถูก resync โดย generation service ตอนเริ่มต้น
  }
}
