import { describe, it, expect } from "vitest";
import { assembleDY, type DYAssembleInput } from "../src/templates/dy.js";
import type { SceneVideoPromptDraftType } from "../src/schemas/llm.js";
import { propImageKey } from "../src/utils/imageReferenceKeys.js";
import { videoPromptStructure } from "../src/utils/videoPromptLanguage.js";

const LOC_ID = "loc001";
const CHAR_A = "charA";
const CHAR_B = "charB";

const baseDraft: SceneVideoPromptDraftType = {
  title: "การพบกันในร้านกาแฟ",
  sceneType: "cafe meeting scene",
  summary: "ปลาเดินเข้าร้านกาแฟและขอนั่งกับมิน",
  visualTone: "anime cel-shaded, warm amber lighting, shallow depth of field",
  shots: [
    {
      durationSec: 5,
      beat: { breakQuality: "soft" },
      camera: "wide shot",
      description: `Wide shot of {{loc:${LOC_ID}}}, {{char:${CHAR_A}}} enters and looks around.`,
      dialogue: [],
      charactersInShot: [CHAR_A],
      lighting: "",
      propsInShot: [],
    },
    {
      durationSec: 6,
      beat: { breakQuality: "hard" },
      camera: "medium shot",
      description: `{{char:${CHAR_B}}} looks up from laptop and smiles.`,
      dialogue: [{ speakerCharacterId: CHAR_B, tone: "softly, warmly", text: "ได้เลยครับ" }],
      charactersInShot: [CHAR_A, CHAR_B],
      lighting: "",
      propsInShot: [],
    },
  ],
  retentionNotes: {
    [LOC_ID]: "warm cafe interior, consistent lighting",
    [CHAR_A]: "appearance and outfit consistent",
    [CHAR_B]: "appearance and outfit consistent",
  },
  soundscape: "Soft cafe ambience, gentle background chatter, coffee machine sounds.",
  music: "Gentle acoustic guitar, warm and light, does not overpower dialogue.",
};

const baseInput: DYAssembleInput = {
  draft: baseDraft,
  locationId: LOC_ID,
  locationBlock: "warm amber lighting, wooden tables, soft background music",
  locationName: "cafe",
  characters: [
    { id: CHAR_A, appearanceBlock: "short black hair, fair skin, gentle expression", name: "ปลา" },
    { id: CHAR_B, appearanceBlock: "neat dark hair, warm smile, casual attire", name: "มิน" },
  ],
  props: [],
  referencePictures: [
    { index: 1, description: "scene keyframe with seating layout" },
    { index: 2, description: "character close-ups" },
  ],
  dialogueLanguage: "Thai",
  clipPolicy: { maxClipSec: 15, targetClipSec: 12, minClipSec: 5 },
};

describe("assembleDY", () => {
  it("สร้าง 1 clip เมื่อ scene สั้นกว่า maxClipSec", () => {
    const result = assembleDY(baseInput);
    expect(result.clips).toHaveLength(1);
    expect(result.clips[0].durationSec).toBe(11);
    expect(result.validationErrors).toHaveLength(0);
  });

  it("prompt ขึ้นต้นด้วย DY,subject_definitions:", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).toMatch(/^DY,subject_definitions:/);
  });

  it("มี Subject 1 = location", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).toContain("<Subject 1> is the cafe environment");
  });

  it("มี Subject 2 และ 3 = characters", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).toContain("<Subject 2>");
    expect(clips[0].prompt).toContain("<Subject 3>");
  });

  it("แทน token {{char:ID}} ด้วย <Subject N>", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).not.toContain(`{{char:${CHAR_A}}}`);
    expect(clips[0].prompt).toContain("<Subject 2>");
  });

  it("มี retention_analysis ครบทุก subject", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).toContain("retention_analysis:");
    expect(clips[0].prompt).toContain("fully_preserved");
  });

  it("มี dialogue ในรูปแบบ <d>[Thai]...</d>", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).toContain("<d>[Thai] ได้เลยครับ</d>");
  });

  it("binds only props used by the clip to an ordered Picture and preserves the speaker ID", () => {
    const { clips } = assembleDY({
      ...baseInput,
      referencePictures: [],
      props: [
        { id: "unused", name: "Watch", visualPrompt: "Gold watch" },
        { id: "prop-1", name: "Envelope", visualPrompt: "Ivory paper envelope" },
      ],
      draft: { ...baseDraft, shots: baseDraft.shots.map((shot, i) => i === 1
        ? { ...shot, propsInShot: ["Envelope", "Envelope"], description: "Picks up {{prop:Envelope}}." }
        : shot) },
    });
    expect(clips[0].referenceSlots.map(slot => slot.role)).toEqual(["location", "character", "character", "prop"]);
    expect(clips[0].referenceSlots.at(-1)).toEqual({ index: 4, name: "Envelope", role: "prop", resourceKey: propImageKey("prop-1") });
    expect(clips[0].prompt).toContain('<Subject 4> is the prop "Envelope" shown in <Picture 4>');
    expect(clips[0].prompt).toContain("Picks up <Subject 4>.");
    expect(clips[0].speakerCharacterIds).toEqual([CHAR_B]);
  });

  it("มี No subtitles or visible text.", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).toContain("No subtitles or visible text.");
  });

  it("timestamp ของ Shot 2 ถูกต้อง (00:05.000)", () => {
    const { clips } = assembleDY(baseInput);
    expect(clips[0].prompt).toContain("At 00:05.000");
  });

  it("keeps the planned lens, framing and dialogue order in a shared shot", () => {
    const { clips } = assembleDY({
      ...baseInput,
      draft: {
        ...baseDraft,
        shots: [{
          ...baseDraft.shots[1],
          camera: "static eye-level two-shot",
          cameraSetup: { focalLengthMm: 35, framing: "medium-wide shot", subjectDistanceM: 2 },
          dialogue: [
            { speakerCharacterId: CHAR_A, tone: "quietly", text: "ไปไหม" },
            { speakerCharacterId: CHAR_B, tone: "warmly", text: "ไปสิ" },
          ],
        }],
      },
    });
    const { prompt } = clips[0];
    expect(prompt).toMatch(/\[Shot 1\] Camera setup: 35 mm medium-wide shot \(full-frame equivalent\)\. Camera-to-subject distance: 2 m\. Camera: static eye-level two-shot\..*<d>\[Thai\] ไปไหม<\/d>.*<d>\[Thai\] ไปสิ<\/d>/);
    const structure = videoPromptStructure(prompt);
    expect(videoPromptStructure(prompt.replace("35 mm", "75 mm"))).not.toBe(structure);
    expect(videoPromptStructure(prompt.replace("medium-wide shot", "reaction close-up"))).not.toBe(structure);
    expect(videoPromptStructure(prompt.replace("distance: 2 m", "distance: 3 m"))).not.toBe(structure);
  });

  it("แบ่ง 2 clips เมื่อ scene ยาวเกิน maxClipSec", () => {
    const longDraft: SceneVideoPromptDraftType = {
      ...baseDraft,
      shots: [
        ...baseDraft.shots,
        { durationSec: 8, beat: { breakQuality: "hard" }, camera: "wide", description: "ending shot", dialogue: [], charactersInShot: [] },
        { durationSec: 7, beat: { breakQuality: "hard" }, camera: "close-up", description: "final shot", dialogue: [], charactersInShot: [] },
      ],
    };
    const result = assembleDY({ ...baseInput, draft: longDraft });
    expect(result.clips.length).toBeGreaterThan(1);
    for (const clip of result.clips) {
      expect(clip.durationSec).toBeLessThanOrEqual(15);
    }
  });

  it("uses the previous end blocking only on the first shot of the next clip", () => {
    const savedState = "The pair already stand one step apart by the desk.";
    const { clips } = assembleDY({
      ...baseInput,
      draft: {
        ...baseDraft,
        shots: [0, 1, 2, 3].map(i => ({
          ...baseDraft.shots[0], durationSec: 6,
          endBlocking: i === 1 ? savedState : undefined,
        })),
      },
    });
    expect(clips).toHaveLength(2);
    expect(clips[0].prompt).not.toContain("Opening continuity:");
    const next = clips[1].prompt;
    expect(next.slice(next.indexOf("[Shot 1]", next.indexOf("detailed_description")), next.indexOf("[Shot 2]", next.indexOf("detailed_description"))))
      .toContain("Previous end state: " + savedState);
    expect(videoPromptStructure(next.replace(savedState, "They enter again."))).not.toBe(videoPromptStructure(next));
  });

  it("ใช้ custom prefix ได้", () => {
    const result = assembleDY({ ...baseInput, promptPrefix: "CUSTOM" });
    expect(result.clips[0].prompt).toMatch(/^CUSTOM,subject_definitions:/);
  });

  it("validationErrors เมื่อ speakerCharacterId ไม่มีใน subjects", () => {
    const badDraft: SceneVideoPromptDraftType = {
      ...baseDraft,
      shots: [{
        ...baseDraft.shots[1],
        dialogue: [{ speakerCharacterId: "unknownId", tone: "softly", text: "test" }],
      }],
    };
    const result = assembleDY({ ...baseInput, draft: badDraft });
    expect(result.validationErrors.some((e) => e.includes("unknownId"))).toBe(true);
  });
});
