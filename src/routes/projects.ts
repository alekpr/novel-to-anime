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

  app.get("/projects/:id/factions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await Project.findById(id).select("factions").lean() as any;
    if (!project) return reply.code(404).send({ error: "Not found" });
    return project.factions ?? [];
  });

  app.post("/projects/:id/factions", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { name: string; description?: string; costumeDescription?: string; costumePrompt?: string };
    if (!body.name?.trim()) return reply.code(400).send({ error: "name required" });
    const project = await Project.findOneAndUpdate(
      { _id: id, "factions.name": { $ne: body.name.trim() } },
      { $push: { factions: { name: body.name.trim(), description: body.description ?? "", costumeDescription: body.costumeDescription ?? "", costumePrompt: body.costumePrompt ?? "" } } },
      { new: true }
    ).select("factions").lean() as any;
    if (!project) return reply.code(409).send({ error: "Faction name already exists" });
    return project.factions ?? [];
  });

  app.delete("/projects/:id/factions/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const project = await Project.findByIdAndUpdate(
      id,
      { $pull: { factions: { name: decodeURIComponent(name) } } },
      { new: true }
    ).select("factions").lean() as any;
    if (!project) return reply.code(404).send({ error: "Not found" });
    return project.factions ?? [];
  });

  app.patch("/projects/:id/factions/:name", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const body = req.body as Partial<{ description: string; costumeDescription: string; costumePrompt: string }>;
    const set: Record<string, unknown> = {};
    if (body.description !== undefined) set["factions.$.description"] = body.description;
    if (body.costumeDescription !== undefined) set["factions.$.costumeDescription"] = body.costumeDescription;
    if (body.costumePrompt !== undefined) set["factions.$.costumePrompt"] = body.costumePrompt;
    const project = await Project.findOneAndUpdate(
      { _id: id, "factions.name": decodeURIComponent(name) },
      { $set: set },
      { new: true }
    ).select("factions").lean() as any;
    if (!project) return reply.code(404).send({ error: "Not found" });
    return project.factions ?? [];
  });

  app.delete("/projects/:id/episodes/:epId", async (req, reply) => {
    const { epId } = req.params as { id: string; epId: string };
    const scenes = await Scene.find({ episodeId: epId }).select("_id").lean();
    const sceneIds = scenes.map(s => s._id);
    if (sceneIds.length > 0) await Shot.deleteMany({ sceneId: { $in: sceneIds } });
    await Scene.deleteMany({ episodeId: epId });
    await Episode.findByIdAndDelete(epId);
    return reply.code(200).send({ deleted: true, scenes: sceneIds.length });
  });
}
