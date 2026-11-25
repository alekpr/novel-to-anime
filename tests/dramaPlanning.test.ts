import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSceneBreakdown } from "../src/services/scene.service.js";
import { buildShotsForScene } from "../src/services/shot.service.js";
import { continuesFromNeighbor, validateSceneCameraHandoff } from "../src/services/sceneCameraHandoff.js";

const db = vi.hoisted(() => ({
  episode: vi.fn(), characters: vi.fn(), locations: vi.fn(), project: vi.fn(), llm: vi.fn(),
  saveScene: vi.fn(), updateScene: vi.fn(), deleteScenes: vi.fn(), saveShot: vi.fn(), deleteShots: vi.fn(),
  neighborScene: vi.fn(), boundaryShot: vi.fn(),
}));
vi.mock("../src/config/index.js", () => ({ config: { llm: { provider: "openai" } } }));
vi.mock("../src/llm/client.js", () => ({
  callStructured: db.llm, GeminiRequestError: class extends Error {}, LLMOutputValidationError: class extends Error {},
}));
vi.mock("../src/queues/jobRunner.js", () => ({ queues: {} }));
vi.mock("../src/models/Episode.js", () => ({ Episode: { findById: db.episode, findByIdAndUpdate: vi.fn() } }));
vi.mock("../src/models/Character.js", () => ({ Character: { find: db.characters } }));
vi.mock("../src/models/Location.js", () => ({ Location: { find: db.locations } }));
vi.mock("../src/models/Project.js", () => ({ Project: { findById: db.project } }));
vi.mock("../src/models/Job.js", () => ({ Job: { findByIdAndUpdate: vi.fn() } }));
vi.mock("../src/models/PropObject.js", () => ({ PropObject: { find: () => ({ lean: async () => [] }) } }));
vi.mock("../src/models/Scene.js", () => ({ Scene: {
  find: () => ({ select: () => ({ lean: async () => [] }) }),
  findOne: db.neighborScene,
  create: db.saveScene, deleteMany: db.deleteScenes, updateOne: db.updateScene, findByIdAndUpdate: vi.fn(),
} }));
vi.mock("../src/models/Shot.js", () => ({ Shot: {
  findOne: db.boundaryShot, findOneAndUpdate: db.saveShot, deleteMany: db.deleteShots,
} }));

const question = "นี่มันเรื่องอะไรกัน! แขกรอกันหมดแล้ว เฟิร์นอยู่ไหน!";
const reply = "คุณอาถามคนนี้เลยครับ มันเป็นคนพาเจ้าสาวของผมหนี";
const episode = {
  _id: "episode", number: 1, targetDurationSec: 21, paragraphs: [
    { idx: 10, text: "**สถานที่:** ร้านดอกไม้ / บ้านเพื่อนเฟิร์น • กลางวัน\n**อารมณ์:** ปะทะ กดดัน" },
    { idx: 12, text: "ประตูร้านเปิดแรง" },
    { idx: 13, text: `**พ่อ:** ${question}` },
    { idx: 14, text: `**นนท์:** ${reply}` },
    { idx: 15, text: "วินวางของในมือลงและสบตาพ่อ" },
    { idx: 16, text: "**วิน:** เรื่องมันไม่ได้เป็นอย่างนั้นครับ" },
    { idx: 17, text: "**จบตอน:** ค้างใบหน้าพ่อ ตัดดำ" },
  ],
};
const characters = [
  { _id: "dad", name: "พ่อ" }, { _id: "non", name: "นนท์" }, { _id: "win", name: "วิน" },
];
const first = {
  order: 1, title: "พ่อเปิดประตู", summary: "ฉากเปิด", locationName: "ร้าน",
  characterNames: ["พ่อ", "นนท์", "วิน"], fromParagraph: 12, toParagraph: 14, estDurationSec: 10,
  entry: "ประตูเปิด", exit: "พ่อหันมองวิน", dialoguePurpose: "ข้อกล่าวหา",
  openingAngle: "side-profile", closingAngle: "frontal",
};
const second = {
  ...first, order: 2, title: "วินตอบ", fromParagraph: 15, toParagraph: 16, estDurationSec: 11,
};
const scene = {
  ...first, _id: "scene", episodeId: "episode", projectId: "project", sceneCode: "EP01-S01",
  sourceRange: { fromParagraph: first.fromParagraph, toParagraph: first.toParagraph },
  characterIds: ["dad", "non", "win"], dramaBeat: first,
};
const direction = {
  blocking: "อยู่ข้างประตู", performance: "พูดทันที", cut: "ตัดรับคำพูด", backgroundActivity: "เสียงในร้าน",
  endBlocking: "พ่อกับนนท์ยืนห่างกันหนึ่งช่วงแขนข้างประตู",
};
const spokenShot = (order: number, durationSec: number, speakerName: string, lineTh: string) => ({
  order, durationSec, camera: "กล้องนิ่ง", cameraAngle: order === 1 ? "side-profile" : "frontal",
  cameraSetup: speakerName
    ? { focalLengthMm: order === 1 ? 65 : 75, framing: order === 1 ? "medium close-up" : "close-up", subjectDistanceM: 1.1 }
    : { focalLengthMm: 35, framing: "medium-wide shot" },
  shotType: "medium", breakQuality: "soft", characterNames: ["พ่อ", "นนท์"], direction,
  portraitFraming: {
    layout: speakerName ? "single" : "environment", focusCharacterNames: speakerName ? [speakerName] : [],
    placement: "อยู่เยื้องขอบหน้าเฟรมและเหลือพื้นที่ทิศที่หันมอง",
  },
  action: "พูดตามเหตุการณ์", dialogue: speakerName ? [{ speakerName, lineTh, tone: "urgent", source: "original" }] : [],
});

beforeEach(() => {
  vi.resetAllMocks();
  db.episode.mockReturnValue({ lean: async () => episode });
  db.characters.mockReturnValue({ select: () => ({ lean: async () => characters }) });
  db.locations.mockReturnValue({ lean: async () => [{ _id: "shop", name: "ร้าน" }] });
  const project = { lean: async () => ({ videoModel: { name: "minimax-h3" }, styleGuide: { aspectRatio: "9:16" } }) };
  db.project.mockReturnValue({ ...project, select: () => project });
  db.updateScene.mockResolvedValue({ matchedCount: 1 });
  db.neighborScene.mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => null }) }) });
});

function returnPlan(plan: unknown) {
  db.llm.mockImplementation(async ({ schema }) => ({ data: schema.parse(plan), tokens: { in: 0, out: 0 } }));
}

describe("short-drama planning", () => {
  it("compares against the actual closing shot of the previous clip", async () => {
    db.neighborScene.mockImplementation(({ order }) => ({ sort: () => ({ select: () => ({
      lean: async () => "$lt" in order ? { _id: "previous", sceneCode: "EP01-S01", dramaBeat: { closingAngle: "side-profile" } } : null,
    }) }) }));
    db.boundaryShot.mockReturnValue({ sort: () => ({ select: () => ({
      lean: async () => ({ cameraAngle: "frontal" }),
    }) }) });
    const nextScene = { ...scene, order: 2, sceneCode: "EP01-S02" };
    await expect(validateSceneCameraHandoff(nextScene, [{ cameraAngle: "three-quarter" }])).rejects.toThrow("ใกล้กับมุมปิด");
    const previous = await validateSceneCameraHandoff(nextScene, [{ cameraAngle: "side-profile" }]);
    expect(previous?.angle).toBe("frontal");
    const last = { ...previous!, locationId: "shop", timeOfDay: "กลางวัน" };
    expect(continuesFromNeighbor({ locationId: "shop", timeOfDay: "กลางวัน" }, last)).toBe(true);
    expect(continuesFromNeighbor({ locationId: "office", timeOfDay: "กลางวัน" }, last)).toBe(false);
    expect(continuesFromNeighbor({ locationId: "shop", timeOfDay: "เย็น" }, last)).toBe(false);
    expect(continuesFromNeighbor({ locationId: "shop", dramaBeat: { entry: "ตัดข้ามเวลาไปวันถัดไป" } }, last)).toBe(false);
  });

  it("rejects an avoidable scene break before Non's reply, then saves both turns in the same scene", async () => {
    returnPlan({ scenes: [{ ...first, toParagraph: 13 }, { ...second, fromParagraph: 14 }] });
    await expect(runSceneBreakdown("project", "episode", "job")).rejects.toThrow("immediate reply in paragraph 14 fits");
    expect(db.deleteScenes).not.toHaveBeenCalled();

    returnPlan({ scenes: [first, second] });
    await runSceneBreakdown("project", "episode", "job");
    expect(db.llm.mock.calls.at(-1)?.[0].user).toContain("[10] **สถานที่:**");
    expect(db.llm.mock.calls.at(-1)?.[0].user).not.toMatch(/\[10\] ~/);
    expect(db.saveScene).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sourceRange: { fromParagraph: 12, toParagraph: 14 },
      dramaBeat: expect.objectContaining({ dialogueBudgetSec: 8.8 }),
    }));
  });

  it("rejects a plan that leaves Non's line out of every scene", async () => {
    returnPlan({ scenes: [{ ...first, toParagraph: 13 }, second] });
    await expect(runSceneBreakdown("project", "episode", "job")).rejects.toThrow("scripted dialogue in paragraphs 14");
    expect(db.deleteScenes).not.toHaveBeenCalled();
  });

  it("allows a scene break at the next turn when the reply cannot fit the preceding scene", async () => {
    returnPlan({ scenes: [
      { ...first, toParagraph: 13, estDurationSec: 8 },
      { ...second, fromParagraph: 14, estDurationSec: 13 },
    ] });
    await runSceneBreakdown("project", "episode", "job");
    expect(db.saveScene).toHaveBeenCalledTimes(2);
  });

  it("rejects a silent cutaway in the exchange and saves two consecutive speaking shots", async () => {
    returnPlan({ shots: [
      spokenShot(1, 4.1, "พ่อ", question),
      spokenShot(2, 1, "", ""),
      spokenShot(3, 4.9, "นนท์", reply),
    ] });
    await expect(buildShotsForScene(scene, episode, characters)).rejects.toThrow();
    const invalid = db.llm.mock.calls[0][0].schema.safeParse({ shots: [
      spokenShot(1, 4.1, "พ่อ", question), spokenShot(2, 1, "", ""), spokenShot(3, 4.9, "นนท์", reply),
    ] });
    expect(invalid.error?.message).toContain("silent cutaway in the exchange leading into paragraph 14");
    expect(db.saveShot).not.toHaveBeenCalled();

    returnPlan({ shots: [spokenShot(1, 4.6, "พ่อ", question), spokenShot(2, 5.4, "นนท์", reply)] });
    await buildShotsForScene(scene, episode, characters);
    expect(db.saveShot).toHaveBeenCalledTimes(2);
    expect(db.saveShot.mock.calls[0][1].$set.cameraSetup).toEqual({ focalLengthMm: 65, framing: "medium close-up", subjectDistanceM: 1.1 });
    expect(db.saveShot.mock.calls[1][1].$set.cameraSetup).toEqual({ focalLengthMm: 75, framing: "close-up", subjectDistanceM: 1.1 });
    expect(db.saveShot.mock.calls[1][1].$set.dialogue).toEqual([
      expect.objectContaining({ speakerId: "non", lineTh: reply }),
    ]);
  });

  it("rejects wide dialogue framing and saves a staggered two-shot for the same exchange", async () => {
    const planned = {
      ...spokenShot(1, 10, "พ่อ", question),
      dialogue: [...spokenShot(1, 4.6, "พ่อ", question).dialogue, ...spokenShot(2, 5.4, "นนท์", reply).dialogue],
      portraitFraming: {
        layout: "depth-two-shot", focusCharacterNames: ["พ่อ", "นนท์"],
        placement: "พ่อเยื้องขอบหน้าเฟรม นนท์อยู่ลึกเข้าไปในช่องประตู เห็นหน้าทั้งสองเมื่อพูด",
      },
    };
    const bad = { shots: [{ ...planned, shotType: "wide" }] };
    returnPlan(bad);
    await expect(buildShotsForScene(scene, episode, characters)).rejects.toThrow();
    expect(db.llm.mock.calls[0][0].schema.safeParse(bad).error?.message).toContain("Use a medium close-up (chest up) or a close-up");
    expect(db.saveShot).not.toHaveBeenCalled();

    const reversed = {
      shots: [{ ...planned, portraitFraming: { ...planned.portraitFraming, focusCharacterNames: ["นนท์", "พ่อ"] } }],
    };
    const invalidOrder = db.llm.mock.calls[0][0].schema.safeParse(reversed);
    expect(invalidOrder.error?.message).toContain("focus must follow the order of speaking: พ่อ, นนท์");

    returnPlan({ shots: [planned] });
    await buildShotsForScene(scene, episode, characters);
    expect(db.llm.mock.calls.at(-1)?.[0].user).toContain("Frame: 9:16");
    expect(db.saveShot.mock.calls[0][1].$set.portraitFraming).toEqual(planned.portraitFraming);
  });

  it("rejects portrait dialogue framed at the waist or labelled close-up with a distant wide lens", async () => {
    const firstShot = spokenShot(1, 4.6, "พ่อ", question);
    const secondShot = spokenShot(2, 5.4, "นนท์", reply);
    returnPlan({ shots: [firstShot, secondShot] });
    await buildShotsForScene(scene, episode, characters);
    const { schema } = db.llm.mock.calls[0][0];
    const validate = (cameraSetup: unknown) => schema.safeParse({ shots: [{ ...firstShot, cameraSetup }, secondShot] });
    expect(validate({ focalLengthMm: 35, framing: "medium shot", subjectDistanceM: 3 }).error?.issues[0].path).toEqual(["shots", 0, "cameraSetup", "framing"]);
    expect(validate({ focalLengthMm: 35, framing: "close-up", subjectDistanceM: 3 }).error?.issues[0].path).toEqual(["shots", 0, "cameraSetup", "subjectDistanceM"]);
    expect(validate({ focalLengthMm: 65, framing: "medium close-up", subjectDistanceM: 1.25 }).success).toBe(true);
  });

  it("requires a focal length and specific framing before saving a generated shot", async () => {
    returnPlan({ shots: [
      { ...spokenShot(1, 4.6, "พ่อ", question), cameraSetup: { framing: "medium" } },
      spokenShot(2, 5.4, "นนท์", reply),
    ] });
    await expect(buildShotsForScene(scene, episode, characters)).rejects.toThrow();
    expect(db.updateScene).not.toHaveBeenCalled();
    expect(db.saveShot).not.toHaveBeenCalled();
  });
});
