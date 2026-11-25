import { FastifyInstance } from "fastify";
import type { Types } from "mongoose";
import { z } from "zod";
import { callStructured, LLMOutputValidationError } from "../llm/client.js";
import { buildShotsForScene, ShotGenerationError, withDramaShotWork } from "../services/shot.service.js";
import { runShortDramaPrompt, type DramaScene } from "../services/shortDramaPrompt.service.js";
import { ProjectActivityError, withProjectActivity } from "../services/projectLifecycle.service.js";
import { Character } from "../models/Character.js";
import { Episode } from "../models/Episode.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { queues } from "../queues/jobRunner.js";

import { DRAMA_REPLAN_MESSAGE, fitsDramaScene, hasInvalidDramaScenes, needsDramaVideoPromptRefresh } from "../utils/shortDrama.js";
import { countDramaDialogue, dramaSpeechSeconds, isSpokenLine } from "../utils/dramaDialogue.js";

async function invalidateShotApproval(sceneId: unknown) {
  await Scene.findByIdAndUpdate(sceneId, { shotsApproved: false, "clips.$[].stale": true });
}

type ApprovalScene = DramaScene & { projectId: Types.ObjectId };

export async function shotRoutes(app: FastifyInstance) {
  app.get("/shots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Shot.findById(id)
      .populate("characterIds", "name appearanceBlock voice")
      .populate("locationId", "name locationBlock");
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });

  app.patch("/shots/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Shot.findByIdAndUpdate(id, req.body as object, { new: true });
    if (!s) return reply.code(404).send({ error: "Not found" });
    await invalidateShotApproval(s.sceneId);
    return s;
  });

  // mark dialogue line reviewed
  app.patch("/shots/:id/dialogue/:idx", async (req, reply) => {
    const { id, idx } = req.params as { id: string; idx: string };
    const body = req.body as { reviewed?: boolean; lineTh?: string; tone?: string };
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0) return reply.code(400).send({ error: "Invalid dialogue index" });
    const update: Record<string, unknown> = {};
    if (body.reviewed !== undefined) update[`dialogue.${i}.reviewed`] = body.reviewed;
    if (body.lineTh !== undefined) {
      update[`dialogue.${i}.lineTh`] = body.lineTh;
      update[`dialogue.${i}.reviewed`] = false;
    }
    if (body.tone !== undefined) update[`dialogue.${i}.tone`] = body.tone;
    const s = await Shot.findByIdAndUpdate(id, { $set: update }, { new: true });
    if (!s) return reply.code(404).send({ error: "Not found" });
    if (body.lineTh !== undefined || body.tone !== undefined || body.reviewed === false) {
      await invalidateShotApproval(s.sceneId);
    }
    return s;
  });

  app.post("/scenes/:id/approve-shots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = await Scene.findById(id).lean<ApprovalScene>();
    if (!scene) return reply.code(404).send({ error: "ไม่พบฉาก" });
    if (hasInvalidDramaScenes([scene])) return reply.code(409).send({ error: DRAMA_REPLAN_MESSAGE });

    const approve = async () => {
      const shots = await Shot.find({ sceneId: id }).sort({ order: 1 })
        .select("order durationSec dialogue characterIds")
        .lean<Array<{ order: number; durationSec: number; dialogue: { lineTh?: string }[]; characterIds: unknown[] }>>();
      if (!shots.length) return reply.code(409).send({ error: "สร้างช็อตของฉากนี้ก่อน" });
      if (scene.dramaBeat && !fitsDramaScene(shots, scene.estDurationSec)) {
        return reply.code(409).send({ error: `ช็อตในซีนต้องรวม ${scene.estDurationSec} วินาทีพอดี` });
      }
      const longShot = scene.dramaBeat && shots.find(shot => dramaSpeechSeconds(shot.dialogue ?? []) > shot.durationSec);
      if (longShot) {
        return reply.code(409).send({ error: `ย่อบทพูดของช็อต ${longShot.order} ให้พูดจบเป็นธรรมชาติใน ${longShot.durationSec} วินาทีก่อนอนุมัติ` });
      }
      if (scene.dramaBeat?.dialoguePurpose?.trim() && !countDramaDialogue(shots)) {
        return reply.code(409).send({ error: "ซีนนี้วางไว้ให้มีบทพูด กรุณาสร้างบทพูดพร้อมผู้พูดก่อนอนุมัติ" });
      }

      let approvedScene = scene;
      if (!scene.shotsApproved) {
        await Shot.updateMany({ sceneId: id }, { $set: { "dialogue.$[].reviewed": true } });
        const updated = await Scene.findOneAndUpdate(
          { _id: id, updatedAt: scene.updatedAt }, { shotsApproved: true }, { new: true },
        ).lean<ApprovalScene>();
        if (!updated) return reply.code(409).send({ error: "ฉากเพิ่งเปลี่ยน กรุณาตรวจช็อตอีกครั้ง" });
        approvedScene = updated;
      }

      const shotCount = shots.length;
      if (!needsDramaVideoPromptRefresh(approvedScene)) return { shotCount, promptStatus: "unchanged" };
      try {
        await queues.prompts.add(() => runShortDramaPrompt(approvedScene), { throwOnTimeout: true });
        return { shotCount, promptStatus: "updated" };
      } catch (error) {
        const latest = await Scene.findById(id).select("shotsApproved dramaBeat clips").lean<ApprovalScene>();
        if (latest?.shotsApproved && !needsDramaVideoPromptRefresh(latest)) {
          return { shotCount, promptStatus: "unchanged" };
        }
        req.log.warn({ sceneId: id, errorType: error instanceof Error ? error.name : "UnknownError" }, "Prompt refresh after shot approval failed");
        return { shotCount, promptStatus: "failed",
          promptError: latest?.shotsApproved
            ? "อนุมัติช็อตแล้ว แต่สร้าง Video Prompt ไม่สำเร็จ กรุณาลองสร้างอีกครั้งที่ซีนนี้"
            : "ช็อตเปลี่ยนระหว่างสร้าง Video Prompt กรุณาตรวจและอนุมัติซีนอีกครั้ง" };
      }
    };

    if (!scene.dramaBeat) return approve();
    try {
      return await withProjectActivity(String(scene.projectId), () => withDramaShotWork(String(scene.episodeId), approve));
    } catch (error) {
      if (error instanceof ShotGenerationError || error instanceof ProjectActivityError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });

  // generate shots for a single scene
  app.post("/scenes/:id/generate-shots", async (req, reply) => {
    const { id } = req.params as { id: string };
    const scene = await Scene.findById(id).lean();
    if (!scene) return reply.code(404).send({ error: "Scene not found" });
    if (hasInvalidDramaScenes([scene])) return reply.code(409).send({ error: DRAMA_REPLAN_MESSAGE });

    const episode = await Episode.findById(scene.episodeId).lean();
    if (!episode) return reply.code(404).send({ error: "Episode not found" });

    const characters = await Character.find({ projectId: scene.projectId, status: "approved" }).lean() as any[];

    try {
      return await withProjectActivity(String(scene.projectId), async () => {
        const result = await buildShotsForScene(scene, episode, characters);
        const shotCount = await Shot.countDocuments({ sceneId: id });
        return { shotCount, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
      });
    } catch (error) {
      if (error instanceof ShotGenerationError || error instanceof ProjectActivityError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      req.log.error({ err: error, sceneId: id }, "Shot generation failed");
      return reply.code(500).send({ error: `${scene.sceneCode} · บันทึกช็อตไม่สำเร็จ กรุณาลองใหม่อีกครั้ง` });
    }
  });

  // generate dialogue for a shot using LLM
  app.post("/shots/:id/generate-dialogue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const shot = await Shot.findById(id).lean();
    if (!shot) return reply.code(404).send({ error: "Not found" });

    const scene = await Scene.findById(shot.sceneId).select("title mood summary dramaBeat")
      .lean<{ title?: string; mood?: string; summary?: string; dramaBeat?: { dialoguePurpose?: string } }>();
    if (scene?.dramaBeat && shot.dialogue.length) {
      return reply.code(409).send({ error: "ช็อตนี้มีบทพูดแล้ว สามารถแก้ข้อความเดิมได้" });
    }
    const durationSec = typeof shot.durationSec === "number" ? shot.durationSec : 0;
    const chars = await Character.find({
      _id: { $in: shot.characterIds },
      ...(scene?.dramaBeat && { status: "approved" }),
    }, "name personality voice").lean();
    if (!chars.length) return reply.code(409).send({ error: "เลือกช็อตที่มีตัวละครผู้พูดก่อน" });

    const charContext = chars.map(c =>
      `- ${c.name}: ${(c as any).personality ?? ""} | speechHabits: [${((c as any).voice?.speechHabits ?? []).join(", ")}]`
    ).join("\n");

    const charMap = new Map(chars.map(c => [c.name, c]));
    const DialogueResult = z.object({
      dialogue: z.array(z.object({
        speakerName: z.string(),
        lineTh: z.string(),
        tone: z.string().default(""),
      })).min(1),
    }).refine(({ dialogue }) =>
      dialogue.every(line => charMap.has(line.speakerName) && isSpokenLine(line.lineTh)) &&
      (!scene?.dramaBeat || (dialogue.every(line => line.tone.trim().length > 0) &&
        dramaSpeechSeconds(dialogue) <= durationSec)),
    `Return only the essential turns in order, from visible speakers with vocal direction, that fit naturally within ${durationSec}s.`);

    const generated = await callStructured({
      system: "คุณคือนักเขียนบท สร้างบทสนทนาที่เป็นธรรมชาติและตรงกับบุคลิกตัวละคร ตอบเป็น JSON เท่านั้น",
      user: `สร้างบทสนทนาสำหรับ shot นี้:

Scene: ${scene?.title ?? ""} | อารมณ์: ${scene?.mood ?? ""}
${scene?.dramaBeat ? `เหตุการณ์ของซีน: ${scene.summary ?? ""}\nจุดที่บทพูดต้องขยับ: ${scene.dramaBeat.dialoguePurpose || "ใช้เฉพาะจังหวะที่จำเป็นในช็อตนี้"}` : ""}
Shot: ${shot.shotCode} | action: ${shot.action} | emotion: ${shot.emotion ?? ""}

ตัวละครในฉาก:
${charContext || "(ไม่มี)"}

${scene?.dramaBeat
  ? `เขียนบทโต้ตอบเฉพาะท่อนที่จำเป็นตามลำดับ ใช้ผู้พูดที่อยู่ในช็อต ให้พูดจบได้ตามธรรมชาติใน ${durationSec} วินาทีและระบุน้ำเสียงทุกท่อน`
  : "สร้างบทสนทนา 1-3 ประโยคที่เหมาะกับ action และ emotion ของ shot นี้"}
ตอบ JSON: { "dialogue": [{ "speakerName": "ชื่อ", "lineTh": "บทพูด", "tone": "น้ำเสียง" }] }`,
      schema: DialogueResult,
      temperature: 0.7,
    }).catch(error => {
      if (scene?.dramaBeat && error instanceof LLMOutputValidationError) return null;
      throw error;
    });
    if (!generated) return reply.code(422).send({ error: `AI ยังเขียนบทพูดที่พอดีกับช็อต ${durationSec} วินาทีไม่ได้ กรุณาลองอีกครั้ง` });

    const newLines = generated.data.dialogue.map(d => ({
      speakerId: charMap.get(d.speakerName)?._id,
      lineTh: d.lineTh,
      tone: d.tone,
      source: "generated",
      reviewed: false,
    }));

    const updated = await Shot.findOneAndUpdate(
      { _id: id, ...(scene?.dramaBeat && { "dialogue.0": { $exists: false } }) },
      { $push: { dialogue: { $each: newLines } } },
      { new: true }
    );
    if (!updated) return reply.code(409).send({ error: "ช็อตเปลี่ยนระหว่างสร้างบทพูด กรุณาตรวจช็อตอีกครั้ง" });
    await invalidateShotApproval(shot.sceneId);
    return updated;
  });

  // mark dialogue reviewed
  app.post("/shots/:id/review-dialogue", async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = await Shot.findByIdAndUpdate(
      id,
      { $set: { "dialogue.$[].reviewed": true } },
      { new: true }
    );
    if (!s) return reply.code(404).send({ error: "Not found" });
    return s;
  });
}
