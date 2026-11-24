import { FastifyInstance } from "fastify";
import { isObjectIdOrHexString, Types } from "mongoose";
import { Project } from "../models/Project.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { z } from "zod";
import { deleteProjectData, ProjectActivityError, withProjectActivity } from "../services/projectLifecycle.service.js";
import { prepareProjectEpisodes, ProjectStoryError } from "../services/projectStory.service.js";
import { episodeParagraphs } from "../utils/storyParagraphs.js";
import { episodeProductionProgress, episodeProductionStatus } from "../utils/episodeProduction.js";

const ProjectTitle = z.string().trim().min(1, "กรุณากรอกชื่อโปรเจกต์");

const CreateProjectBody = z.object({
  title: ProjectTitle,
  language: z.string().default("th"),
  genre: z.string().trim().optional(),
  storySource: z.object({
    mode: z.enum(["story", "outline"]),
    text: z.string().trim().min(1, "กรุณากรอกเนื้อเรื่องหรือโครงเรื่อง"),
    episodeCount: z.number().int().positive().safe(),
  }).optional(),
});

const UpdateProjectBody = z.object({ title: ProjectTitle.optional() }).catchall(z.unknown());

const CreateEpisodeBody = z.object({
  number: z.number().int().positive(),
  title: z.string().default(""),
  text: z.string().min(1),
});

export async function projectRoutes(app: FastifyInstance) {
  app.post("/projects", async (req, reply) => {
    const parsed = CreateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const error = issue.path[0] === "storySource" && issue.path[1] === "episodeCount"
        ? "จำนวนตอนต้องเป็นจำนวนเต็มตั้งแต่ 1 ตอนขึ้นไป"
        : issue.message;
      return reply.code(400).send({ error });
    }

    const { title, language, storySource } = parsed.data;
    const genre = parsed.data.genre || undefined;
    if (!storySource) {
      const project = await Project.create({ title, language, genre });
      return reply.code(201).send(project);
    }

    try {
      const { drafts, genre: storyGenre } = await prepareProjectEpisodes(title, language, storySource, genre);
      const project = new Project({ title, language, storySource, genre: storyGenre });
      await project.validate();

      // Publish the project after its episodes have been inserted.
      try {
        await Episode.insertMany(drafts.map(draft => ({ projectId: project._id, ...draft })));
        await project.save();
      } catch (error) {
        if (!await Project.exists({ _id: project._id })) {
          await Episode.deleteMany({ projectId: project._id });
          throw error;
        }
      }
      return reply.code(201).send({
        ...project.toObject(),
        storySource: { mode: storySource.mode, episodeCount: storySource.episodeCount },
      });
    } catch (error) {
      if (error instanceof ProjectStoryError) return reply.code(error.statusCode).send({ error: error.message });
      req.log.error({ err: error }, "Could not save project episodes");
      return reply.code(500).send({ error: "บันทึกโปรเจกต์ไม่สำเร็จ กรุณาลองอีกครั้ง" });
    }
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
    if (!isObjectIdOrHexString(id)) return reply.code(400).send({ error: "รหัสโปรเจกต์ไม่ถูกต้อง" });
    const parsed = UpdateProjectBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    if (!Object.keys(parsed.data).length) return reply.code(400).send({ error: "กรุณาระบุข้อมูลที่ต้องการแก้ไข" });

    try {
      const project = await withProjectActivity(id, () =>
        Project.findByIdAndUpdate(id, { $set: parsed.data }, { new: true, runValidators: true }));
      if (!project) return reply.code(404).send({ error: "ไม่พบโปรเจกต์" });
      return project;
    } catch (error) {
      if (error instanceof ProjectActivityError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.delete("/projects/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { confirm?: unknown } | undefined;
    if (!isObjectIdOrHexString(id)) return reply.code(400).send({ error: "รหัสโปรเจกต์ไม่ถูกต้อง" });
    if (body?.confirm !== true) return reply.code(400).send({ error: "กรุณายืนยันการลบโปรเจกต์" });
    try {
      await deleteProjectData(new Types.ObjectId(id));
      return { deleted: true };
    } catch (error) {
      if (error instanceof ProjectActivityError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      req.log.error({ err: error, projectId: id }, "Project deletion failed");
      return reply.code(500).send({ error: "ลบโปรเจกต์ไม่ครบ กรุณาลองลบอีกครั้ง" });
    }
  });

  app.post("/projects/:id/episodes", async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CreateEpisodeBody.parse(req.body);

    const paragraphs = episodeParagraphs(body.text);

    const episode = await withProjectActivity(id, async () => {
      // Clear the previous breakdown before re-importing an episode.
      const oldEp = await Episode.findOne({ projectId: id, number: body.number }).select("_id").lean();
      if (oldEp) {
        const oldScenes = await Scene.find({ episodeId: oldEp._id }).select("_id").lean();
        const oldSceneIds = oldScenes.map(s => s._id);
        if (oldSceneIds.length > 0) {
          await Shot.deleteMany({ sceneId: { $in: oldSceneIds } });
        }
        await Scene.deleteMany({ episodeId: oldEp._id });
      }

      return Episode.findOneAndUpdate(
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
    });
    return reply.code(201).send(episode);
  });

  app.get("/projects/:id/episodes", async (req) => {
    const { id } = req.params as { id: string };
    const episodes = await Episode.find({ projectId: id }).sort({ number: 1 }).lean();
    if (!episodes.length) return episodes;

    const scenes = await Scene.find({ episodeId: { $in: episodes.map(episode => episode._id) } })
      .select("episodeId dramaBeat estDurationSec shotsApproved clips.videoPrompt clips.durationSec clips.stale").lean();
    const shots = scenes.length
      ? await Shot.find({ sceneId: { $in: scenes.map(scene => scene._id) } }).select("sceneId characterIds dialogue").lean()
      : [];
    const scenesByEpisode = new Map<string, typeof scenes>();
    for (const scene of scenes) {
      const key = String(scene.episodeId);
      const list = scenesByEpisode.get(key);
      if (list) list.push(scene);
      else scenesByEpisode.set(key, [scene]);
    }
    const shotsByScene = new Map<string, typeof shots>();
    for (const shot of shots) {
      const key = String(shot.sceneId);
      const list = shotsByScene.get(key);
      if (list) list.push(shot);
      else shotsByScene.set(key, [shot]);
    }

    return episodes.map(episode => {
      const episodeScenes = scenesByEpisode.get(String(episode._id)) ?? [];
      const episodeShots = episodeScenes.flatMap(scene => shotsByScene.get(String(scene._id)) ?? []);
      return { ...episode, productionStatus: episodeProductionStatus(episode.status, episodeProductionProgress(episodeScenes, episodeShots)) };
    });
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
