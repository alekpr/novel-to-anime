import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config/index.js";
import { generateSceneAudio, getSceneDialogueLines, listElevenLabsVoices, setCharacterVoiceId } from "../services/elevenlabs.service.js";

export async function elevenLabsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (_req, reply) => { reply.header("Cache-Control", "no-store"); });

  // List available voices
  app.get("/elevenlabs/voices", async (_req, reply) => {
    try {
      return { voices: await listElevenLabsVoices() };
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });

  // Set voice ID for a character
  app.post<{ Params: { id: string }; Body: { voiceId: string } }>("/characters/:id/set-elevenlabs-voice", async (req, reply) => {
    try {
      return await setCharacterVoiceId(req.params.id, req.body.voiceId ?? "");
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });

  // Get dialogue lines + voice assignments for a scene
  app.get<{ Params: { id: string } }>("/scenes/:id/elevenlabs-lines", async (req, reply) => {
    try {
      return await getSceneDialogueLines(req.params.id);
    } catch (e) {
      return reply.code(422).send({ error: (e as Error).message });
    }
  });

  // Generate audio for all lines in a scene
  app.post<{ Params: { id: string }; Body: { stability?: number; similarityBoost?: number; style?: number } }>(
    "/scenes/:id/generate-elevenlabs-audio", async (req, reply) => {
      try {
        const results = await generateSceneAudio(req.params.id, config.dataDir, req.body);
        return { results };
      } catch (e) {
        return reply.code(422).send({ error: (e as Error).message });
      }
    }
  );

  // Serve generated audio files
  app.get<{ Params: { sceneId: string; filename: string } }>("/elevenlabs/audio/:sceneId/:filename", async (req, reply) => {
    const { sceneId, filename } = req.params;
    if (!/^[a-f0-9]{24}$/.test(sceneId) || !/^[\w\-]+\.mp3$/.test(filename)) {
      return reply.code(400).send({ error: "Invalid path" });
    }
    const filePath = path.join(config.dataDir, "assets", "elevenlabs", sceneId, filename);
    try {
      const { size } = await stat(filePath);
      return reply.header("Content-Type", "audio/mpeg").header("Content-Length", size).send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: "ไม่พบไฟล์เสียง" });
    }
  });
}
