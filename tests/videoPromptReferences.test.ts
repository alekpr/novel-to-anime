import { Types } from "mongoose";
import { expect, it, vi } from "vitest";
import { runShortDramaPrompt } from "../src/services/shortDramaPrompt.service.js";
import { outfitImageKeys, propImageKey } from "../src/utils/imageReferenceKeys.js";
import { buildSendFormData, clipAudioSlots, clipImageSlots } from "../web/src/features/video/clipReferences.js";
import type { Character, Clip, PropObject } from "../web/src/lib/api.js";

const db = vi.hoisted(() => ({
  characters: vi.fn(), locations: vi.fn(), shots: vi.fn(), scenes: vi.fn(),
  props: vi.fn(), project: vi.fn(), save: vi.fn(), generate: vi.fn(), workspace: vi.fn(),
  neighbor: vi.fn(), boundaryShot: vi.fn(),
}));
vi.mock("../src/models/Character.js", () => ({ Character: { find: db.characters } }));
vi.mock("../src/models/Location.js", () => ({ Location: { find: db.locations } }));
vi.mock("../src/models/Shot.js", () => ({ Shot: { find: db.shots, findOne: db.boundaryShot } }));
vi.mock("../src/models/Scene.js", () => ({ Scene: {
  find: db.scenes, updateOne: db.save,
  findOne: db.neighbor,
} }));
vi.mock("../src/models/PropObject.js", () => ({ PropObject: { find: db.props } }));
vi.mock("../src/models/Project.js", () => ({ Project: { findById: db.project } }));
vi.mock("../src/llm/client.js", () => ({ callStructured: db.generate }));
vi.mock("../web/src/features/images/imageResourceStore.js", () => ({ inspectImageWorkspace: db.workspace }));

it("binds shot props to H3 Picture slots and resolves only the actual speaker's uploaded audio", async () => {
  const [projectId, sceneId, episodeId, speakerId, listenerId, locationId, propId] =
    Array.from({ length: 7 }, () => new Types.ObjectId());
  const outfit = { name: "Raincoat", description: "Blue raincoat" };
  const prop = { _id: propId, name: "Envelope", visualPrompt: "Ivory paper envelope" };
  const direction = { blocking: "On the desk", performance: "", cut: "", backgroundActivity: "" };
  const portraitFraming = { layout: "over-the-shoulder", focusCharacterNames: ["Mali"], placement: "Mali beyond the listener's shoulder" };
  const cameraSetup = { focalLengthMm: 65, framing: "medium close-up", subjectDistanceM: 1.25 };
  const shot = { _id: new Types.ObjectId(), order: 1, durationSec: 4, direction, characterIds: [speakerId, listenerId] };
  db.characters.mockReturnValue({ lean: async () => [
    { _id: speakerId, name: "Mali", outfits: [outfit] }, { _id: listenerId, name: "Niran" },
  ] });
  db.locations.mockReturnValue({ lean: async () => [{ _id: locationId, name: "Office" }] });
  db.shots.mockReturnValue({ sort: () => ({ lean: async () => [
    { ...shot, cameraSetup, portraitFraming, propIds: [propId, propId], dialogue: [{ speakerId, lineTh: "เปิดดูสิ", reviewed: true }] },
    { ...shot, _id: new Types.ObjectId(), order: 2, dialogue: [] },
  ] }) });
  db.scenes.mockReturnValue({ select: () => ({ lean: async () => [] }) });
  const endBlocking = "ทั้งสองยืนชิดกันข้างโต๊ะ มาลีถือซองไว้ที่มือขวา";
  db.neighbor.mockImplementation(({ order }) => ({ sort: () => ({ select: () => ({
    lean: async () => "$lt" in order ? {
      _id: new Types.ObjectId(), sceneCode: "S01", locationId, timeOfDay: "กลางวัน",
      dramaBeat: { exit: "มาลีอยู่ข้างประตู" },
    } : null,
  }) }) }));
  db.boundaryShot.mockReturnValue({ sort: () => ({ select: () => ({
    lean: async () => ({ cameraAngle: "frontal", direction: { endBlocking } }),
  }) }) });
  db.props.mockReturnValue({ select: () => ({ lean: async () => [prop] }) });
  db.project.mockReturnValue({ select: () => ({ lean: async () => null }) });
  db.save.mockResolvedValue({ matchedCount: 1 });
  db.generate.mockImplementation(async ({ schema }) => ({ data: schema.parse({
    overview: "An envelope changes hands.", blocking: "Both characters stand at the desk.",
    openingBlocking: "Both already stand close beside the desk, and <Subject 1> holds the envelope in her right hand.",
    soundAndEditing: "Paper rustles.",
    references: ["Blue raincoat", "Brown coat", "Office", "Ivory envelope"]
      .map((description, i) => ({ subject: i + 1, description })),
    shots: [
      { order: 1, direction: "Mali reaches across the desk.",
        portraitFraming: "Frame <Subject 1> beyond the listener's shoulder, clear of the face.", spokenDelivery: [{
        language: "Thai", cue: "", actionDuringSpeech: "<Subject 1> lifts the envelope while speaking.",
      }] },
      { order: 2, direction: "Niran watches.", spokenDelivery: [] },
    ],
  }) }));

  await runShortDramaPrompt({
    _id: sceneId, projectId, episodeId, locationId, characterIds: [speakerId, listenerId], updatedAt: new Date(),
    sceneCode: "S02", order: 2, timeOfDay: "กลางวัน", estDurationSec: 8, shotsApproved: true,
    dramaBeat: { entry: "ทั้งสองเดินเข้าหากัน", exit: "A quiet reaction" }, clips: [],
  });

  expect(db.props).toHaveBeenCalledWith({ projectId, _id: { $in: [String(propId)] } });
  const input = JSON.parse(db.generate.mock.calls[0][0].user);
  expect(input.previousEndBlocking).toBe(endBlocking);
  expect(input.opening).toBeUndefined();
  expect(input.references.at(-1)).toMatchObject({ subject: 4, role: "prop", description: expect.stringContaining("Ivory paper envelope") });
  expect(input.shots.map((item: { propSubjects: number[] }) => item.propSubjects)).toEqual([[4], []]);
  expect(input.shots[0].portraitFraming).toEqual(portraitFraming);
  expect(input.shots[0].cameraSetup).toEqual(cameraSetup);

  const clip: Clip = db.save.mock.calls[0][1].$set.clips[0];
  expect(clip.referenceSlots?.at(-1)).toEqual({ index: 4, name: "Envelope", role: "prop", resourceKey: propImageKey(String(propId)) });
  expect(clip.videoPrompt).toContain("<Subject 4>: <Picture 4>[Ivory envelope]");
  expect(clip.videoPrompt).toContain("Match the props shown in this shot to <Subject 4>.");
  expect(clip.videoPrompt).toContain("Portrait framing: Frame <Subject 1> beyond the listener's shoulder, clear of the face.");
  expect(clip.videoPrompt).toContain("Camera setup: 65 mm medium close-up (full-frame equivalent). Camera-to-subject distance: 1.25 m.");
  const firstShot = clip.videoPrompt.indexOf("\n\n[Shot 1]");
  const secondShot = clip.videoPrompt.indexOf("\n\n[Shot 2]");
  expect(clip.videoPrompt.slice(firstShot, secondShot)).toContain("Both already stand close beside the desk");
  expect(clip.videoPrompt.slice(secondShot)).not.toContain("Opening continuity:");
  expect(clip.videoPrompt).toContain("Action during the next line: <Subject 1> lifts the envelope while speaking.\n<Subject 1> (S1) says: <d>[Thai] เปิดดูสิ</d>");
  expect(clip.speakerCharacterIds).toEqual([String(speakerId)]);

  const resources = {
    chars: [
      { _id: String(speakerId), name: "Mali", outfits: [outfit], voice: { audioReference: "ref.wav" } },
      { _id: String(listenerId), name: "Niran", voice: { audioReference: "ref.mp3" } },
    ] as Character[],
    locs: [],
    props: [{ ...prop, _id: String(propId) }] as PropObject[],
  };
  expect(clipImageSlots(clip, resources)[0].key).toBe(outfitImageKeys(resources.chars[0])[0]);
  expect(clipImageSlots(clip, resources).at(-1)?.key).toBe(propImageKey(String(propId)));
  const attached = [{ charId: String(speakerId), name: "Mali", audioRef: "ref.wav" }];
  expect(clipAudioSlots(clip, resources).attached).toEqual(attached);
  expect(clipAudioSlots({ ...clip, speakerCharacterIds: undefined }, resources).attached).toEqual(attached);

  const pictureSlots = clipImageSlots(clip, resources);
  db.workspace.mockResolvedValue({ references: Object.fromEntries(pictureSlots.map(slot => [
    slot.key!, { status: "ready", file: new File(["image"], slot.role + ".png") },
  ])) });
  const fetchAudio = vi.fn(async () => new Response("voice"));
  vi.stubGlobal("fetch", fetchAudio);
  try {
    const form = await buildSendFormData(clip, String(projectId), resources);
    expect(Array.from(form.keys())).toEqual(["promptVersion", "picture-1", "picture-2", "picture-3", "picture-4", `audio-${speakerId}`]);
    expect(form.get("picture-4")).toHaveProperty("name", "prop.png");
    expect(form.get(`audio-${speakerId}`)).toHaveProperty("name", `${speakerId}.wav`);
    expect(fetchAudio).toHaveBeenCalledExactlyOnceWith(`/api/characters/${speakerId}/audio-reference`);
  } finally {
    vi.unstubAllGlobals();
  }
});
