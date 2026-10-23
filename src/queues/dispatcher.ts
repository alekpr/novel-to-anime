import { Job } from "../models/Job.js";
import { runBibleExtraction } from "../services/bible.service.js";
import { runSceneBreakdown } from "../services/scene.service.js";
import { runShotList } from "../services/shot.service.js";
import { runQA } from "../services/qa.service.js";
import { queues } from "./jobRunner.js";

type Stage = "S1" | "S2" | "S3" | "S5";

export async function dispatchJob(
  projectId: string,
  episodeId: string,
  stage: Stage
): Promise<string> {
  const job = await Job.create({ projectId, episodeId, stage, status: "queued" });
  const jobId = job._id.toString();

  const queueMap: Record<Stage, typeof queues.bible> = {
    S1: queues.bible,
    S2: queues.scenes,
    S3: queues.shots,
    S5: queues.qa,
  };

  const runnerMap: Record<Stage, (p: string, e: string, j: string) => Promise<void>> = {
    S1: runBibleExtraction,
    S2: runSceneBreakdown,
    S3: runShotList,
    S5: async (p, e, j) => {
      await Job.findByIdAndUpdate(j, { status: "running", progress: 0.1 });
      const report = await runQA(p, e);
      await Job.findByIdAndUpdate(j, {
        status: "succeeded",
        progress: 1,
        error: report.passed ? null : `พบ ${report.issues.filter(i => i.severity === "error").length} errors`,
        finishedAt: new Date(),
      });
    },
  };

  queueMap[stage].add(async () => {
    try {
      await runnerMap[stage](projectId, episodeId, jobId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[dispatcher] stage=${stage} FAILED:`, err);
      await Job.findByIdAndUpdate(jobId, {
        status: "failed",
        error: msg,
        finishedAt: new Date(),
      });
    }
  });

  return jobId;
}
