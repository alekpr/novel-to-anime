import Fastify from "fastify";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "./config/index.js";
import { connectDb } from "./config/db.js";
import { resyncOnStartup } from "./queues/resync.js";
import { projectRoutes } from "./routes/projects.js";
import { episodeRoutes } from "./routes/episodes.js";
import { jobRoutes } from "./routes/jobs.js";
import { healthRoutes } from "./routes/health.js";
import { fileRoutes } from "./routes/files.js";
import { characterRoutes } from "./routes/characters.js";
import { locationRoutes } from "./routes/locations.js";
import { sceneRoutes } from "./routes/scenes.js";
import { shotRoutes } from "./routes/shots.js";
import { promptRoutes } from "./routes/prompts.js";
import { exportRoutes } from "./routes/export.js";
import { qaRoutes } from "./routes/qa.js";

const ALLOWED_ORIGINS = [
  `http://localhost:${config.port}`,
  `http://127.0.0.1:${config.port}`,
  `http://localhost:5173`,   // Vite dev server
  `http://127.0.0.1:5173`,
  `http://localhost:5174`,   // Vite dev server
  `http://127.0.0.1:5174`,
];

export async function buildApp() {
  const app = Fastify({ logger: { transport: { target: "pino-pretty" } } });

  // ตรวจ Host/Origin เพื่อป้องกัน DNS rebinding (หัวข้อ 18.6)
  app.addHook("onRequest", async (req, reply) => {
    const host = req.headers.host ?? "";
    const origin = req.headers.origin ?? "";
    const allowedHosts = [`localhost:${config.port}`, `127.0.0.1:${config.port}`, `localhost:5173`, `127.0.0.1:5173`,`localhost:5174`, `127.0.0.1:5174`];

    if (!allowedHosts.includes(host)) {
      return reply.code(403).send({ error: "Forbidden host" });
    }
    if (origin && !ALLOWED_ORIGINS.includes(origin)) {
      return reply.code(403).send({ error: "Forbidden origin" });
    }
  });

  app.register(projectRoutes);
  app.register(episodeRoutes);
  app.register(jobRoutes);
  app.register(healthRoutes);
  app.register(fileRoutes);
  app.register(characterRoutes);
  app.register(locationRoutes);
  app.register(sceneRoutes);
  app.register(shotRoutes);
  app.register(promptRoutes);
  app.register(exportRoutes);
  app.register(qaRoutes);

  // เสิร์ฟ web build (web/dist) ถ้ามี
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(__dirname, "../web/dist");
  if (fs.existsSync(webDist)) {
    app.register(import("@fastify/static").then(m => m.default), {
      root: webDist,
      prefix: "/",
      decorateReply: false,
    });
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html", webDist);
    });
  }

  return app;
}

async function main() {
  // สร้างโฟลเดอร์ data/ ถ้ายังไม่มี
  for (const dir of ["assets", "exports", "backups", "logs"]) {
    fs.mkdirSync(`${config.dataDir}/${dir}`, { recursive: true });
  }

  await connectDb();
  await resyncOnStartup();

  const app = await buildApp();
  await app.listen({ host: config.host, port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
