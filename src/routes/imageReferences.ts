import type { FastifyInstance } from "fastify";
import { Buffer } from "node:buffer";
import { isObjectIdOrHexString } from "mongoose";
import { ImageReferenceError, parseReferenceSlot, updateImageReference } from "../services/imageReference.service.js";
import { ProjectActivityError } from "../services/projectLifecycle.service.js";

const imageBodyLimit = 5_000_000;

export async function imageReferenceRoutes(app: FastifyInstance) {
  app.addContentTypeParser("image/jpeg", { parseAs: "buffer", bodyLimit: imageBodyLimit }, (_req, body, done) => done(null, body));
  app.post<{ Params: { projectId: string }; Querystring: { key?: string } }>("/projects/:projectId/image-reference", {
    bodyLimit: imageBodyLimit,
  }, async (req, reply) => {
    const { projectId } = req.params;
    if (!isObjectIdOrHexString(projectId)) return reply.code(404).send({ error: "ไม่พบโปรเจกต์" });
    const { key } = req.query;
    if (typeof key !== "string" || key.length > 5000) return reply.code(400).send({ error: "เลือกช่องภาพอ้างอิงให้ถูกต้อง" });
    if (!Buffer.isBuffer(req.body) || req.body.length < 5 ||
        req.body.subarray(0, 3).toString("hex") !== "ffd8ff" || req.body.subarray(-2).toString("hex") !== "ffd9") {
      return reply.code(400).send({ error: "อ่านไฟล์ภาพอ้างอิงไม่ได้ กรุณาเลือกภาพอีกครั้ง" });
    }

    try {
      return await updateImageReference(projectId, parseReferenceSlot(key), req.body);
    } catch (error) {
      if (error instanceof ImageReferenceError || error instanceof ProjectActivityError) {
        return reply.code(error.statusCode).send({ error: error.message });
      }
      throw error;
    }
  });
}
