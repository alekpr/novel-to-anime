import { FastifyInstance } from "fastify";
import fs from "fs";
import { exportEpisode } from "../services/export.service.js";
import { withProjectActivity } from "../services/projectLifecycle.service.js";

const MIME: Record<string, string> = {
  json: "application/json",
  md: "text/markdown",
  csv: "text/csv",
};

export async function exportRoutes(app: FastifyInstance) {
  app.get("/episodes/:id/export", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { format = "json" } = req.query as { format?: string };

    if (!["json", "md", "csv"].includes(format)) {
      return reply.code(400).send({ error: "format must be json, md, or csv" });
    }

    const episode = await import("../models/Episode.js").then((m) => m.Episode.findById(id).lean());
    if (!episode) return reply.code(404).send({ error: "Episode not found" });

    const projectId = episode.projectId.toString();
    return withProjectActivity(projectId, async () => {
      const filePath = await exportEpisode(projectId, id, format as "json" | "md" | "csv");

      const epCode = `EP${String(episode.number).padStart(2, "0")}`;
      const downloadName = `${epCode}-export.${format}`;

      reply
        .header("Content-Type", MIME[format])
        .header("Content-Disposition", `attachment; filename="${downloadName}"`)
        .header("Content-Length", fs.statSync(filePath).size);

      return reply.send(fs.createReadStream(filePath));
    });
  });
}
