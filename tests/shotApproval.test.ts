import Fastify from "fastify";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { shotRoutes } from "../src/routes/shots.js";

const mocks = vi.hoisted(() => ({
  findScene: vi.fn(), saveApproval: vi.fn(), findShots: vi.fn(), reviewDialogue: vi.fn(),
  queuePrompt: vi.fn(), refreshPrompt: vi.fn(),
}));

vi.mock("../src/models/Scene.js", () => ({
  Scene: { findById: mocks.findScene, findOneAndUpdate: mocks.saveApproval },
}));
vi.mock("../src/models/Shot.js", () => ({
  Shot: { find: mocks.findShots, updateMany: mocks.reviewDialogue },
}));
vi.mock("../src/services/shortDramaPrompt.service.js", () => ({
  runShortDramaPrompt: mocks.refreshPrompt,
}));
vi.mock("../src/services/shot.service.js", () => ({
  ShotGenerationError: class extends Error {},
  withDramaShotWork: (_id: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("../src/services/projectLifecycle.service.js", () => ({
  ProjectActivityError: class extends Error {},
  withProjectActivity: (_id: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("../src/queues/jobRunner.js", () => ({
  queues: { prompts: { add: mocks.queuePrompt } },
}));

const scene = {
  _id: "scene-1", episodeId: "episode-1", projectId: "project-1", estDurationSec: 4,
  updatedAt: new Date("2026-01-01T00:00:00Z"), shotsApproved: false, dramaBeat: { dialoguePurpose: "Reveal" },
};
const shots = [{
  order: 1, durationSec: 4, characterIds: ["speaker"],
  dialogue: [{ speakerId: "speaker", lineTh: "เปิดดูสิ", reviewed: false }],
}];

const app = Fastify();
app.register(shotRoutes);

function approve() {
  return app.inject({ method: "POST", url: "/scenes/scene-1/approve-shots" });
}

function setScene(clips: { videoPrompt?: string; stale?: boolean }[], shotsApproved = false) {
  const initial = { ...scene, clips, shotsApproved };
  const approved = { ...initial, shotsApproved: true };
  mocks.findScene.mockReturnValue({ lean: async () => initial });
  mocks.saveApproval.mockReturnValue({ lean: async () => approved });
  return approved;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findShots.mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => shots }) }) });
  mocks.queuePrompt.mockImplementation((task: () => Promise<unknown>) => task());
});
afterAll(() => app.close());

describe("approving shots", () => {
  it.each([
    [],
    [{ stale: true, videoPrompt: "  " }],
    [{ stale: false, videoPrompt: "Current prompt" }],
  ].map(clips => ({ clips })))("saves approval without scheduling a refresh for $clips", async ({ clips }) => {
    setScene(clips);
    const response = await approve();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ shotCount: 1, promptStatus: "unchanged" });
    expect(mocks.reviewDialogue).toHaveBeenCalledWith({ sceneId: scene._id }, { $set: { "dialogue.$[].reviewed": true } });
    expect(mocks.saveApproval).toHaveBeenCalledWith(
      { _id: scene._id, updatedAt: scene.updatedAt }, { shotsApproved: true }, { new: true },
    );
    expect(mocks.queuePrompt).not.toHaveBeenCalled();
  });

  it("refreshes the previously generated prompt after saving approval", async () => {
    const approved = setScene([{ stale: true, videoPrompt: "Old prompt" }]);
    const response = await approve();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ shotCount: 1, promptStatus: "updated" });
    expect(mocks.refreshPrompt).toHaveBeenCalledExactlyOnceWith(approved);
    expect(mocks.saveApproval.mock.invocationCallOrder[0]).toBeLessThan(mocks.queuePrompt.mock.invocationCallOrder[0]);
  });

  it("allows a retry when the shots are already approved and an existing prompt is stale", async () => {
    const approved = setScene([{ stale: true, videoPrompt: "Old prompt" }], true);
    const response = await approve();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ shotCount: 1, promptStatus: "updated" });
    expect(mocks.saveApproval).not.toHaveBeenCalled();
    expect(mocks.refreshPrompt).toHaveBeenCalledExactlyOnceWith(approved);
  });
});
