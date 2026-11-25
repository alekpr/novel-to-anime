import { FastifyInstance } from "fastify";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Location } from "../models/Location.js";
import { Scene } from "../models/Scene.js";
import { analyzeEpisodeBgm, getEpisodeBgmAnalysis } from "../services/episodeBgm.service.js";
import { generateLyriaAudio } from "../services/lyria.service.js";
import { config } from "../config/index.js";
import { Shot } from "../models/Shot.js";
import { episodeProductionProgress } from "../utils/episodeProduction.js";
import { episodeBibleSelector } from "../utils/episodeBible.js";
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

    // รับ targetDurationSec จาก body (optional) — บันทึกลง episode ก่อน run
    const body = req.body as { targetDurationSec?: number | null };
    if (body?.targetDurationSec !== undefined) {
      if (body.targetDurationSec !== null && (!Number.isFinite(body.targetDurationSec) || body.targetDurationSec <= 0)) {
        return reply.code(400).send({ error: "เวลารวมของตอนต้องมากกว่าศูนย์" });
      }
      await Episode.findByIdAndUpdate(id, { targetDurationSec: body.targetDurationSec ?? null });
    }

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
    const [allChars, allLocs, scenes] = await Promise.all([
      Character.find({ projectId }).select("name episodes firstAppearanceEp status").lean(),
      Location.find({ projectId }).select("name episodes status").lean(),
      Scene.find({ episodeId: id }).lean(),
    ]);
    const shots = scenes.length
      ? await Shot.find({ sceneId: { $in: scenes.map(s => s._id) } }).lean()
      : [];

    const selectForEpisode = episodeBibleSelector(ep);
    const sceneCharacterIds = new Set(scenes.flatMap(scene => (scene.characterIds ?? []).map(String)));
    const sceneLocationIds = new Set(scenes.flatMap(scene => {
      const beat = scene.dramaBeat;
      const supportingIds = beat && typeof beat === "object" && "supportingLocationIds" in beat &&
        Array.isArray(beat.supportingLocationIds) ? beat.supportingLocationIds : [];
      return [scene.locationId, ...supportingIds].filter(Boolean).map(String);
    }));
    const chars = selectForEpisode(allChars, sceneCharacterIds);
    const locs = selectForEpisode(allLocs, sceneLocationIds);

    const hasText = (ep.paragraphs?.length ?? 0) > 0;
    const charsApproved = chars.filter(c => c.status === "approved").length;
    const locsApproved = locs.filter(l => l.status === "approved").length;
    const bibleApproved = hasText && chars.length > 0 && charsApproved === chars.length && locsApproved === locs.length;
    const {
      hasScenes, scenesReady, hasShots, shotsApproved, dialogueMissing, dialogueApproved,
      unreviewedDialogue, scenesWithClips, clipsHavePrompts,
    } = episodeProductionProgress(scenes, shots);

    type StepStatus = "locked" | "ready" | "needs_review" | "approved";
    const step = (condition: boolean, prev: boolean, hasData: boolean): StepStatus => {
      if (!prev) return "locked";
      if (hasData) return condition ? "approved" : "needs_review";
      return "ready";
    };

    return {
      steps: [
        { key: "import",  label: "นำเข้า",   status: step(hasText, true, hasText) },
        { key: "bible",   label: "Bible",    status: step(bibleApproved, hasText, chars.length > 0 || locs.length > 0) },
        { key: "scenes",  label: "Scenes",   status: step(scenesReady, bibleApproved, hasScenes) },
        { key: "shots",   label: "Shots",    status: step(shotsApproved, scenesReady, hasShots) },
        { key: "images",  label: "ภาพ Prompt", status: step(false, scenesReady && hasShots, false) },
        { key: "clips",   label: "Clips",    status: step(clipsHavePrompts, scenesReady && hasShots, scenesWithClips > 0) },
        { key: "video",   label: "Video Prompt", status: step(false, dialogueApproved && scenesWithClips > 0, false) },
        { key: "export",  label: "Export",   status: step(false, hasShots, false) },
      ],
      bible: {
        characterIds: chars.map(char => String(char._id)),
        locationIds: locs.map(loc => String(loc._id)),
      },
      counts: {
        chars: chars.length, charsApproved,
        locs: locs.length, locsApproved,
        scenes: scenes.length, shots: shots.length,
        unreviewedDialogue, scenesWithClips, dialogueMissing, dialogueApproved,
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

  app.get("/episodes/:id/bgm-analysis", async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return { analysis: await getEpisodeBgmAnalysis(id) }; }
    catch (e) { return reply.code(422).send({ error: (e as Error).message }); }
  });

  app.post("/episodes/:id/analyze-bgm", async (req, reply) => {
    const { id } = req.params as { id: string };
    try { return { analysis: await analyzeEpisodeBgm(id) }; }
    catch (e) { return reply.code(422).send({ error: (e as Error).message }); }
  });

  // Manually set audioUrl for a cue (without regenerating)
  app.patch("/episodes/:id/bgm-cue/:cueNumber/audio-url", async (req, reply) => {
    const { id, cueNumber } = req.params as { id: string; cueNumber: string };
    const { audioUrl } = req.body as { audioUrl: string };
    if (!audioUrl?.trim()) return reply.code(400).send({ error: "audioUrl is required" });
    const idx = parseInt(cueNumber, 10) - 1;
    await Episode.findByIdAndUpdate(id, { [`bgmAnalysis.cues.${idx}.audioUrl`]: audioUrl });
    return { ok: true };
  });

  // Generate Lyria audio for a specific cue
  app.post("/episodes/:id/generate-lyria-cue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { cueNumber, prompt, durationSec } = req.body as { cueNumber: number; prompt: string; durationSec: number };
    if (!prompt?.trim()) return reply.code(400).send({ error: "prompt is required" });
    if (!durationSec || durationSec <= 0) return reply.code(400).send({ error: "durationSec is required" });
    try {
      const filename = `ep_${id}_cue${cueNumber}_v${Date.now()}.mp3`;
      const result = await generateLyriaAudio(prompt, durationSec, config.audioDir, filename);
      // persist audioUrl into bgmAnalysis.cues
      await Episode.findByIdAndUpdate(id, {
        [`bgmAnalysis.cues.${cueNumber - 1}.audioUrl`]: result.url,
      });
      return result;
    } catch (e) {
      const msg = (e as Error).message;
      console.error("[lyria] generate error:", msg);
      return reply.code(422).send({ error: msg });
    }
  });

  // Serve generated audio files
  app.get("/audio/:filename", async (req, reply) => {
    const { filename } = req.params as { filename: string };
    if (filename.includes("..") || filename.includes("/")) return reply.code(400).send({ error: "invalid" });
    const filePath = `${config.audioDir}/${filename}`;
    try {
      const stream = (await import("fs")).createReadStream(filePath);
      return reply.type("audio/mpeg").send(stream);
    } catch { return reply.code(404).send({ error: "not found" }); }
  });
}
