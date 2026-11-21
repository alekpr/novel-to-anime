import { FastifyInstance } from "fastify";
import { PropObject } from "../models/PropObject.js";

export async function propRoutes(app: FastifyInstance) {
  // List props for a project
  app.get("/projects/:projectId/props", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const props = await PropObject.find({ projectId }).sort({ category: 1, name: 1 }).lean();
    return props;
  });

  // Update a prop
  app.patch("/props/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const prop = await PropObject.findByIdAndUpdate(id, req.body as object, { new: true });
    if (!prop) return reply.code(404).send({ error: "Not found" });
    return prop;
  });

  // Approve a prop
  app.post("/props/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const prop = await PropObject.findByIdAndUpdate(id, { status: "approved" }, { new: true });
    if (!prop) return reply.code(404).send({ error: "Not found" });
    return prop;
  });

  // Delete a prop
  app.delete("/props/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    await PropObject.findByIdAndDelete(id);
    return { ok: true };
  });
}
