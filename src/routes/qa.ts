import { FastifyInstance } from "fastify";
import { runQA } from "../services/qa.service.js";
import { Episode } from "../models/Episode.js";

export async function qaRoutes(app: FastifyInstance) {
  app.get("/episodes/:id/qa", async (req, reply) => {
    const { id } = req.params as { id: string };
    const episode = await Episode.findById(id).lean();
    if (!episode) return reply.code(404).send({ error: "Not found" });
    const report = await runQA(episode.projectId.toString(), id);
    return report;
  });
}
