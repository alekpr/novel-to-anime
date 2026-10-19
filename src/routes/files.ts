import { FastifyInstance } from "fastify";
import path from "path";
import fs from "fs";
import { createReadStream } from "fs";
import { config } from "../config/index.js";

export async function fileRoutes(app: FastifyInstance) {
  app.get("/files/*", async (req, reply) => {
    const wildcard = (req.params as { "*": string })["*"];
    const filePath = path.resolve(config.dataDir, wildcard);

    if (!filePath.startsWith(config.dataDir)) {
      return reply.code(403).send({ error: "Forbidden" });
    }

    if (!fs.existsSync(filePath)) {
      return reply.code(404).send({ error: "Not found" });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".mp4": "video/mp4", ".webm": "video/webm",
      ".mp3": "audio/mpeg", ".wav": "audio/wav",
      ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
    };
    reply.header("Content-Type", mimeMap[ext] ?? "application/octet-stream");
    return reply.send(createReadStream(filePath));
  });
}
