import Fastify from "fastify";
import { Buffer } from "node:buffer";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { imageReferenceRoutes } from "../src/routes/imageReferences.js";
import { characterImageKey, locationImageKey, outfitImageKeys } from "../src/utils/imageReferenceKeys.js";

const { findCharacter, findLocation, saveCharacter, saveLocation, findScenes, markScenes, generatePrompt, llm } = vi.hoisted(() => ({
  findCharacter: vi.fn(),
  findLocation: vi.fn(),
  saveCharacter: vi.fn(),
  saveLocation: vi.fn(),
  findScenes: vi.fn(),
  markScenes: vi.fn(),
  generatePrompt: vi.fn(),
  llm: {
    provider: "gemini",
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://api.openai.com/v1",
    vision: { apiKey: "test-key", model: "test-model" },
  },
}));

vi.mock("../src/models/Character.js", () => ({
  Character: { findOne: findCharacter, updateOne: saveCharacter },
}));
vi.mock("../src/models/Location.js", () => ({
  Location: { findOne: findLocation, updateOne: saveLocation },
}));
vi.mock("../src/models/Scene.js", () => ({
  Scene: { find: findScenes, updateMany: markScenes },
}));
vi.mock("../src/queues/jobRunner.js", () => ({
  queues: { prompts: { addAll: (tasks: (() => Promise<unknown>)[]) => Promise.all(tasks.map(task => task())) } },
}));
vi.mock("../src/services/prompt.service.js", () => ({
  runPromptGeneration: generatePrompt,
}));
vi.mock("../src/services/projectLifecycle.service.js", () => ({
  ProjectActivityError: class extends Error {},
  withProjectActivity: (_id: string, operation: () => Promise<unknown>) => operation(),
}));
vi.mock("../src/config/index.js", () => ({
  config: { llm },
}));

const projectId = "000000000000000000000001";
const targetId = "000000000000000000000002";
const updatedAt = new Date("2026-01-01T00:00:00Z");
const image = Buffer.from("ffd8ffe00001ffd9", "hex");
const app = Fastify();
app.register(imageReferenceRoutes);

function mockGemini(visuals: object) {
  const request = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(visuals) }] }, finishReason: "STOP" }],
  })));
  vi.stubGlobal("fetch", request);
  return request;
}

function submit(key: string, payload = image) {
  return app.inject({
    method: "POST", url: `/projects/${projectId}/image-reference`, query: { key },
    headers: { "Content-Type": "image/jpeg" }, payload,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  llm.provider = "gemini";
  saveCharacter.mockResolvedValue({ matchedCount: 1 });
  saveLocation.mockResolvedValue({ matchedCount: 1 });
  findScenes.mockReturnValue({ select: () => ({ lean: async () => [] }) });
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => app.close());

describe("updating a prompt from an attached reference", () => {
  it("sends the image bytes to Gemini and updates only the selected outfit, including duplicate names", async () => {
    const char = { _id: targetId, updatedAt, name: "Mali", outfits: [{ name: "Work" }, { name: "work" }] };
    findCharacter.mockReturnValue({ lean: async () => char });
    const request = mockGemini({ appearance: "Short black bob", wardrobe: "Blue linen jacket" });

    const response = await submit(outfitImageKeys(char)[1]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ updated: true, promptUpdates: [] });
    expect(findCharacter).toHaveBeenCalledWith({ _id: targetId, projectId });
    const [, options] = request.mock.calls[0];
    expect(JSON.parse(String(options?.body)).contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/jpeg", data: image.toString("base64") },
    });
    expect(saveCharacter).toHaveBeenCalledExactlyOnceWith({ _id: targetId, updatedAt }, {
      $set: {
        "outfits.1.referenceAppearance": "Short black bob",
        "outfits.1.outfitPrompt": "Blue linen jacket",
        "outfits.1.outfitSheetPrompt": expect.stringContaining("2×2"),
      },
      $inc: { version: 1 },
    });
  });

  it("updates the base appearance without overwriting the Story Bible wardrobe", async () => {
    findCharacter.mockReturnValue({ lean: async () => ({ _id: targetId, updatedAt, name: "Mali" }) });
    mockGemini({ appearance: "Round face and long dark hair", wardrobe: "An ivory shirt" });

    expect((await submit(characterImageKey(targetId))).statusCode).toBe(200);
    expect(saveCharacter).toHaveBeenCalledExactlyOnceWith({ _id: targetId, updatedAt }, {
      $set: {
        appearanceBlock: "Round face and long dark hair", referenceWardrobe: "An ivory shirt",
        characterSheetPrompt: expect.stringContaining("Wardrobe: An ivory shirt"),
      },
      $inc: { version: 1 },
    });
  });

  it("uses the reference location for both the video context and the 2×2 sheet", async () => {
    findLocation.mockReturnValue({ lean: async () => ({ _id: targetId, updatedAt, name: "Suite" }) });
    mockGemini({ location: "Sunlit room with curved oak doors" });

    expect((await submit(locationImageKey(targetId))).statusCode).toBe(200);
    expect(saveLocation).toHaveBeenCalledExactlyOnceWith({ _id: targetId, updatedAt }, {
      $set: {
        locationBlock: "Sunlit room with curved oak doors",
        masterPrompt: expect.stringContaining("2×2 production reference sheet of Suite. Sunlit room with curved oak doors"),
      },
      $inc: { version: 1 },
    });
  });

  it("routes the attached image to OpenAI when OpenAI is selected for the app", async () => {
    llm.provider = "openai";
    findLocation.mockReturnValue({ lean: async () => ({ _id: targetId, updatedAt, name: "Suite" }) });
    const request = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      object: "response",
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"location":"Sunlit room"}' }] }],
    }));
    vi.stubGlobal("fetch", request);

    expect((await submit(locationImageKey(targetId))).statusCode).toBe(200);
    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const payload = JSON.parse(String(options?.body));
    expect(payload).toMatchObject({
      model: "test-model",
      store: false,
      input: [{ role: "user", content: [
        { type: "input_text", text: expect.stringContaining("Return one valid JSON object only.") },
        { type: "input_image", image_url: `data:image/jpeg;base64,${image.toString("base64")}` },
      ] }],
    });
    expect(saveLocation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      $set: expect.objectContaining({ locationBlock: "Sunlit room" }),
    }));
  });

  it("preserves the existing prompt when the selected subject is unreadable", async () => {
    findLocation.mockReturnValue({ lean: async () => ({ _id: targetId, updatedAt, name: "Suite" }) });
    mockGemini({ location: "" });

    expect((await submit(locationImageKey(targetId))).statusCode).toBe(422);
    expect(saveLocation).not.toHaveBeenCalled();
    expect(findScenes).not.toHaveBeenCalled();
  });

  it("refreshes existing prompts for the exact outfit within the project, including other episodes", async () => {
    const char = { _id: targetId, updatedAt, name: "Mali", outfits: [{ name: "Work" }, { name: "Work" }] };
    const key = outfitImageKeys(char)[1];
    const scenes = [
      { _id: "scene-1", episodeId: "episode-1", sceneCode: "EP01-S02" },
      { _id: "scene-2", episodeId: "episode-2", sceneCode: "EP02-S04" },
    ];
    findCharacter.mockReturnValue({ lean: async () => char });
    findScenes.mockReturnValue({ select: () => ({ lean: async () => scenes }) });
    generatePrompt.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("รออนุมัติช็อต"));
    mockGemini({ appearance: "Short black bob", wardrobe: "Blue linen jacket" });

    const response = await submit(key);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ updated: true, promptUpdates: [
      { sceneId: "scene-1", episodeId: "episode-1", sceneCode: "EP01-S02" },
      { sceneId: "scene-2", episodeId: "episode-2", sceneCode: "EP02-S04", error: "รออนุมัติช็อต" },
    ] });
    const promptFilter = { projectId, clips: { $elemMatch: { videoPrompt: /\S/, "referenceSlots.resourceKey": key } } };
    expect(findScenes).toHaveBeenCalledExactlyOnceWith(promptFilter);
    expect(markScenes).toHaveBeenCalledExactlyOnceWith({
      ...promptFilter, _id: { $in: ["scene-1", "scene-2"] },
    }, { $set: { "clips.$[].stale": true } });
    expect(generatePrompt.mock.calls).toEqual([["scene-1"], ["scene-2"]]);
    expect(saveCharacter.mock.invocationCallOrder[0]).toBeLessThan(generatePrompt.mock.invocationCallOrder[0]);
  });
});
