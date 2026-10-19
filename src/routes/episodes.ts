import { FastifyInstance } from "fastify";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Location } from "../models/Location.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { dispatchJob } from "../queues/dispatcher.js";

export async function episodeRoutes(app: FastifyInstance) {
  app.post("/episodes/:id/run/:stage", { config: { rawBody: false } }, async (req, reply) => {
    const { id, stage } = req.params as { id: string; stage: string };
    const validStages = ["S1", "S2", "S3", "S5"];
    if (!validStages.includes(stage)) {
      return reply.code(400).send({ error: `Invalid stage. Use: ${validStages.join(", ")}` });
    }

    const episode = await Episode.findById(id).lean();
    if (!episode) return reply.code(404).send({ error: "Episode not found" });

    const jobId = await dispatchJob(
      episode.projectId.toString(),
      id,
      stage as "S1" | "S2" | "S3" | "S5"
    );
    return reply.code(202).send({ jobId });
  });

  // สถานะ 8 ขั้นของ episode
  app.get("/episodes/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ep = await Episode.findById(id).lean();
    if (!ep) return reply.code(404).send({ error: "Not found" });

    const projectId = ep.projectId.toString();
    const epNumber = ep.number;
    const [allChars, allLocs, scenes] = await Promise.all([
      Character.find({ projectId }).lean(),
      Location.find({ projectId }).lean(),
      Scene.find({ episodeId: id }).lean(),
    ]);
    const shots = scenes.length
      ? await Shot.find({ sceneId: { $in: scenes.map(s => s._id) } }).lean()
      : [];

    // กรองเฉพาะ chars/locs ที่ปรากฏใน episode นี้
    const chars = allChars.filter(c => (c as any).episodes?.includes(epNumber));
    const locs = allLocs.filter(l => (l as any).episodes?.includes(epNumber));

    const hasText = (ep.paragraphs?.length ?? 0) > 0;
    const allCharsApproved = chars.length > 0 && chars.every(c => c.status === "approved");
    const allLocsApproved = chars.length > 0 && locs.every(l => l.status === "approved");
    const bibleApproved = allCharsApproved && allLocsApproved;
    const hasScenes = scenes.length > 0;
    const hasShots = shots.length > 0;
    const unreviewedDialogue = shots.filter(sh =>
      (sh.dialogue as any[]).some((d: any) => d.source === "generated" && !d.reviewed)
    ).length;
    const scenesWithClips = scenes.filter(s => (s.clips as any[]).length > 0).length;
    const clipsHavePrompts = scenesWithClips > 0 &&
      scenes.every(s => (s.clips as any[]).every((c: any) => c.videoPrompt));

    type StepStatus = "locked" | "ready" | "needs_review" | "approved";
    const step = (condition: boolean, prev: boolean, hasData: boolean): StepStatus => {
      if (!prev) return "locked";
      if (hasData) return condition ? "approved" : "needs_review";
      return "ready";
    };

    return {
      steps: [
        { key: "import",  label: "นำเข้า",   status: step(hasText, true, hasText) },
        { key: "bible",   label: "Bible",    status: step(bibleApproved, hasText, chars.length > 0) },
        { key: "scenes",  label: "Scenes",   status: step(hasScenes, bibleApproved, hasScenes) },
        { key: "shots",   label: "Shots",    status: step(hasShots && unreviewedDialogue === 0, hasScenes, hasShots) },
        { key: "images",  label: "ภาพ Prompt", status: step(false, hasShots, false) },
        { key: "clips",   label: "Clips",    status: step(clipsHavePrompts, hasShots, scenesWithClips > 0) },
        { key: "video",   label: "Video Prompt", status: step(false, scenesWithClips > 0, false) },
        { key: "export",  label: "Export",   status: step(false, hasShots, false) },
      ],
      counts: {
        chars: chars.length, charsApproved: chars.filter(c => c.status === "approved").length,
        locs: locs.length, locsApproved: locs.filter(l => l.status === "approved").length,
        scenes: scenes.length, shots: shots.length,
        unreviewedDialogue, scenesWithClips,
      },
    };
  });

  app.get("/episodes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ep = await Episode.findById(id).lean();
    if (!ep) return reply.code(404).send({ error: "Not found" });
    return ep;
  });

  app.patch("/episodes/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const ep = await Episode.findByIdAndUpdate(id, req.body as object, { new: true });
    if (!ep) return reply.code(404).send({ error: "Not found" });
    return ep;
  });
}
