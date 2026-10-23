import { FastifyInstance } from "fastify";
import { Project } from "../models/Project.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { z } from "zod";

const CreateProjectBody = z.object({
  title: z.string().min(1),
  language: z.string().default("th"),
});

const CreateEpisodeBody = z.object({
  number: z.number().int().positive(),
  title: z.string().default(""),
  text: z.string().min(1),
});

export async function projectRoutes(app: FastifyInstance) {
  app.post("/projects", async (req, reply) => {
    const body = CreateProjectBody.parse(req.body);
    const project = await Project.create(body);
    return reply.code(201).send(project);
  });

  app.get("/projects", async () => {
    return Project.find().sort({ createdAt: -1 });
  });

  app.get("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await Project.findById(id);
    if (!project) return reply.code(404).send({ error: "Not found" });
    return project;
  });

  app.patch("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await Project.findByIdAndUpdate(id, req.body as object, { new: true });
    if (!project) return reply.code(404).send({ error: "Not found" });
    return project;
  });

  app.post("/projects/:id/episodes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CreateEpisodeBody.parse(req.body);

    // S0: แบ่งย่อหน้า — รองรับทั้ง double newline และ single newline
    const rawParas = body.text.split(/\n{2,}/).map(t => t.trim()).filter(Boolean)
    const paragraphs = (rawParas.length > 1 ? rawParas : body.text.split(/\n/).map(t => t.trim()).filter(Boolean))
      .map((text, idx) => ({ idx, text }))

    // clear S2/S3/S4 ของ EP นี้ก่อน import ใหม่
    const oldEp = await Episode.findOne({ projectId: id, number: body.number }).select("_id").lean();
    if (oldEp) {
      const oldScenes = await Scene.find({ episodeId: oldEp._id }).select("_id").lean();
      const oldSceneIds = oldScenes.map(s => s._id);
      if (oldSceneIds.length > 0) {
        await Shot.deleteMany({ sceneId: { $in: oldSceneIds } });
      }
      await Scene.deleteMany({ episodeId: oldEp._id });
    }

    const episode = await Episode.findOneAndUpdate(
      { projectId: id, number: body.number },
      {
        $set: {
          title: body.title,
          paragraphs,
          status: "ingested",
        },
      },
      { upsert: true, new: true }
    );
    return reply.code(201).send(episode);
  });

  app.get("/projects/:id/episodes", async (req) => {
    const { id } = req.params as { id: string };
    return Episode.find({ projectId: id }).sort({ number: 1 });
  });
}
