import { FastifyInstance } from "fastify";
import { Job } from "../models/Job.js";

export async function jobRoutes(app: FastifyInstance) {
  app.get("/jobs/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await Job.findById(id);
    if (!job) return reply.code(404).send({ error: "Not found" });
    return job;
  });

  // SSE stream สำหรับ progress
  app.get("/jobs/:id/stream", async (req, reply) => {
    const { id } = req.params as { id: string };
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");

    const send = (data: object) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const poll = setInterval(async () => {
      const job = await Job.findById(id).lean();
      if (!job) { clearInterval(poll); reply.raw.end(); return; }
      send({ status: job.status, progress: job.progress, error: job.error });
      if (job.status === "succeeded" || job.status === "failed") {
        clearInterval(poll);
        reply.raw.end();
      }
    }, 1000);

    req.raw.on("close", () => clearInterval(poll));
  });
}
