import { FastifyInstance } from "fastify";
import { z } from "zod";
import { callStructured } from "../llm/client.js";
import { Location } from "../models/Location.js";

export async function locationRoutes(app: FastifyInstance) {
  app.get("/projects/:id/locations", async (req) => {
    const { id } = req.params as { id: string };
    return Location.find({ projectId: id }).sort({ name: 1 });
  });

  app.get("/locations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = await Location.findById(id);
    if (!l) return reply.code(404).send({ error: "Not found" });
    return l;
  });

  app.patch("/locations/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = await Location.findByIdAndUpdate(id, req.body as object, { new: true });
    if (!l) return reply.code(404).send({ error: "Not found" });
    return l;
  });

  app.post("/locations/:id/approve", async (req, reply) => {
    const { id } = req.params as { id: string };
    const l = await Location.findByIdAndUpdate(
      id,
      { $set: { status: "approved", needsReview: false }, $inc: { version: 1 } },
      { new: true }
    );
    if (!l) return reply.code(404).send({ error: "Not found" });
    return l;
  });

  // Regenerate locationBlock + masterPrompt
  app.post("/locations/:id/regenerate-prompts", async (req, reply) => {
    const { id } = req.params as { id: string };
    const loc = await Location.findById(id).lean() as any;
    if (!loc) return reply.code(404).send({ error: "Not found" });

    const others = await Location.find({ projectId: loc.projectId, _id: { $ne: loc._id } })
      .select("name locationBlock")
      .lean() as any[];

    const othersContext = others
      .filter((o) => o.locationBlock)
      .map((o) => `- ${o.name}: ${o.locationBlock}`)
      .join("\n");

    const LocationPromptsResult = z.object({
      locationBlock: z.string(),
      masterPrompt: z.string(),
    });

    const { data } = await callStructured({
      system: "You are an anime background designer. Generate distinct, detailed English location descriptions for anime scenes. Each location must have a unique visual identity.",
      user: `Regenerate prompts for this location. Make it visually DISTINCT from other locations.

Location to regenerate:
- Name: ${loc.name}
- Type: ${loc.type}
- Description: ${loc.description ?? ""}
- Time of day: ${loc.timeOfDay ?? ""}
- Lighting: ${loc.lighting ?? ""}
- Mood: ${loc.mood ?? ""}
- Key elements: ${(loc.keyElements ?? []).join(", ")}
- Current locationBlock: ${loc.locationBlock ?? "(none)"}

OTHER locations already defined (make this one look different):
${othersContext || "(none)"}

Rules:
1. locationBlock — concise descriptor for use inside video prompts: "[type], [key visual elements], [lighting], [mood]" — max 20 words
2. masterPrompt — full prompt for generating a standalone background image: detailed, atmospheric, anime style
3. Both in English, ready to paste into an image generator

Return JSON: { "locationBlock": "...", "masterPrompt": "..." }`,
      schema: LocationPromptsResult,
      temperature: 0.7,
    });

    const updated = await Location.findByIdAndUpdate(
      id,
      { $set: { locationBlock: data.locationBlock, masterPrompt: data.masterPrompt } },
      { new: true }
    );
    return updated;
  });
}
