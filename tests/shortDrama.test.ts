import { describe, expect, it } from "vitest";
import { assembleShortDramaH3 } from "../src/templates/shortDramaH3.js";
import { characterReferenceSheet, locationReferenceSheet } from "../src/templates/referenceSheet.js";
import { DRAMA_EP_SECONDS, alignDramaShotTiming, fitsDramaScene, hasInvalidDramaScenes, minimumDramaSceneCount } from "../src/utils/shortDrama.js";
import { usesLatinVideoPrompt } from "../src/utils/videoPromptLanguage.js";
import { cameraAngleFromDirection, distinctDramaAngles } from "../src/utils/dramaCamera.js";

describe("Thai short drama", () => {
  it("keeps the one-minute default and rejects invalid shot timing", () => {
    const durations = [0.6, 2.3, 5.4, 2.8, 2.9, 1];
    const shots = durations.map((durationSec, index) => ({
      order: index + 1, durationSec, dialogue: index === 2 ? ["บทพูด"] : [],
    }));
    expect(DRAMA_EP_SECONDS).toBe(60);
    expect(fitsDramaScene(shots, 15)).toBe(true);
    expect(fitsDramaScene(shots.map(shot => ({ ...shot, dialogue: [] })), 15)).toBe(true);
    expect(fitsDramaScene(shots.slice(0, -1), 15)).toBe(false);
    expect(fitsDramaScene([{ ...shots[0], durationSec: 0.65 }, ...shots.slice(1)], 15)).toBe(false);
  });

  it("calculates the minimum scene count from the full episode duration", () => {
    expect(minimumDramaSceneCount(60)).toBe(4);
    expect(minimumDramaSceneCount(120)).toBe(8);
    expect(minimumDramaSceneCount(121)).toBe(9);
  });

  it("repairs small time differences on silent shots and preserves spoken duration", () => {
    const shots = [
      { order: 1, durationSec: 3.8, dialogue: [] },
      { order: 2, durationSec: 5, dialogue: ["บทพูด"] },
      { order: 3, durationSec: 3, dialogue: [] },
    ];
    expect(alignDramaShotTiming(shots, 12).map(shot => shot.durationSec)).toEqual([4, 5, 3]);
    expect(alignDramaShotTiming(shots, 11).map(shot => shot.durationSec)).toEqual([3.3, 5, 2.7]);
    expect(alignDramaShotTiming(shots, 15)).toEqual(shots);
    expect(shots[0].durationSec).toBe(3.8);
  });

  it("extends a short dialogue shot when a small adjustment to a silent shot makes room", () => {
    const shots = [
      { order: 1, durationSec: 4, dialogue: [{ lineTh: Array(14).fill("go").join(" ") }] },
      { order: 2, durationSec: 3.9, dialogue: [] },
    ];

    const adjusted = alignDramaShotTiming(shots, 8);
    expect(adjusted.map(shot => shot.durationSec)).toEqual([4.3, 3.7]);
    expect(fitsDramaScene(adjusted, 8)).toBe(true);
    expect(shots.map(shot => shot.durationSec)).toEqual([4, 3.9]);
  });

  it("allows a continuous shot for the father's question and Non's full accusation", () => {
    const dialogue = [
      { lineTh: "นี่มันเรื่องอะไรกัน! แขกรอกันหมดแล้ว เฟิร์นอยู่ไหน!" },
      { lineTh: "คุณอาถามคนนี้เลยครับ มันเป็นคนพาเจ้าสาวของผมหนี" },
    ];
    const shots = [{ order: 1, durationSec: 10, dialogue }];
    expect(fitsDramaScene(shots, 10)).toBe(true);
    expect(alignDramaShotTiming(shots, 10)).toEqual(shots);
    const { prompt } = assembleShortDramaH3({
      overview: "The father enters and Non answers immediately.",
      references: [
        { name: "พ่อ", role: "character", description: "An older man in a suit" },
        { name: "นนท์", role: "character", description: "A younger man in a groom's suit" },
      ],
      blocking: "Keep both men visible beside the doorway.",
      soundAndEditing: "The door opens under the first line.",
      shots: [{
        durationSec: 10,
        direction: "Hold the two-shot as the younger man answers.",
        dialogue: dialogue.map(({ lineTh }, i) => ({ subject: i + 1, text: lineTh, language: "Thai", delivery: "" })),
      }],
    });
    expect(Array.from(prompt.matchAll(/<d>\[Thai\] (.*?)<\/d>/g), match => match[1])).toEqual(dialogue.map(line => line.lineTh));
    expect(prompt).not.toContain("[Shot 2]");
  });

  it("rejects saved drama scenes over 15 seconds before shot or clip generation", () => {
    const shots = [4, 4, 4, 4].map((durationSec, index) => ({ order: index + 1, durationSec }));
    expect(fitsDramaScene(shots, 16)).toBe(false);
    expect(fitsDramaScene(shots.slice(0, 3), 12)).toBe(true);
    expect(fitsDramaScene([{ order: 1, durationSec: 3 }], 3)).toBe(false);
    expect(hasInvalidDramaScenes([28, 32, 32, 28].map(estDurationSec => ({ dramaBeat: {}, estDurationSec })))).toBe(true);
    expect(hasInvalidDramaScenes([{ dramaBeat: {}, estDurationSec: 15 }])).toBe(false);
    expect(hasInvalidDramaScenes([{ estDurationSec: 28 }])).toBe(false);
  });

  it("uses the actual per-clip duration and a local timeline in shorter prompts", () => {
    const { prompt } = assembleShortDramaH3({
      overview: "Continue her reaction.",
      blocking: "Stay on the same axis.",
      soundAndEditing: "Carry over room tone.",
      references: [],
      shots: [
        { durationSec: 2.4, cameraAngle: "frontal", direction: "CU.", dialogue: [] },
        { durationSec: 3.6, cameraAngle: "side-profile", direction: "Reverse.", dialogue: [] },
      ],
    });
    expect(prompt).toMatch(/^6 seconds, vertical/);
    expect(prompt).toContain("[Shot 2] 00:02.400–00:06.000. Camera angle: side-profile.");
    expect(prompt).toContain("End at 00:06.000.");
  });

  it("requires a clearly changed viewpoint at the scene boundary", () => {
    expect(cameraAngleFromDirection("ภาพใกล้ มุมหน้าตรง 50 มม.")).toBe("frontal");
    expect(cameraAngleFromDirection("Wide from front, head-on")).toBe("frontal");
    expect(distinctDramaAngles("frontal", "frontal")).toBe(false);
    expect(distinctDramaAngles("frontal", "three-quarter")).toBe(false);
    expect(distinctDramaAngles("overhead", "high-angle")).toBe(false);
    expect(distinctDramaAngles("frontal", "side-profile")).toBe(true);
    expect(distinctDramaAngles("side-profile", "low-angle")).toBe(true);
  });

  it("keeps each line in its spoken language and binds speakers independently of picture order", () => {
    const { prompt, references } = assembleShortDramaH3({
      overview: "Start on her reaction.",
      blocking: "Win stays screen left.",
      soundAndEditing: "Distant traffic and natural room tone.",
      references: [
        { name: "วิน", role: "character", description: "Win in blue plaid" },
        { name: "ฟ้า", role: "character", description: "Fah in the ivory gown" },
        { name: "รถตู้", role: "location", description: "Parked van" },
      ],
      shots: [
        { durationSec: 0.6, direction: "CU of lace.", dialogue: [] },
        { durationSec: 4.4, direction: "Cut to Fah.", dialogue: [{ subject: 2, text: "ออกเลยค่ะ", language: "Thai", delivery: "in a low, steady voice" }] },
        { durationSec: 6, direction: "Reverse to Win.", dialogue: [{ subject: 1, text: "Where are we going?", language: "English", delivery: "" }] },
        { durationSec: 4, direction: "Cut to Fah.", dialogue: [{ subject: 2, text: "すぐわかるよ。", language: "Japanese", delivery: "in a firm voice" }] },
      ],
    });
    expect(references.map(ref => [ref.index, ref.name])).toEqual([[1, "วิน"], [2, "ฟ้า"], [3, "รถตู้"]]);
    expect(prompt).toContain("<Subject 2>: <Picture 2>[Fah in the ivory gown]");
    expect(prompt).toContain("<Subject 2> (S1) speaks only in [Shot 2], [Shot 4].");
    expect(prompt).toContain("<Subject 2> (S1) says in a low, steady voice: <d>[Thai] ออกเลยค่ะ</d>");
    expect(prompt).toContain("<Subject 1> (S2) says: <d>[English] Where are we going?</d>");
    expect(prompt).toContain("<Subject 2> (S1) says in a firm voice: <d>[Japanese] すぐわかるよ。</d>");
    expect(prompt).toContain("Keep all production directions unspoken.");
    expect(prompt).not.toContain("Vocal direction:");
    expect(usesLatinVideoPrompt(prompt)).toBe(true);
    expect(prompt).toContain("[Shot 2] 00:00.600–00:05.000.");
    expect(prompt).toContain("[Shot 4] 00:11.000–00:15.000.");
    expect(prompt).toContain("BACKGROUND ACTIVITY, SOUND AND EDITING");
  });

  it("detects non-Latin text in references, directions and malformed dialogue tags", () => {
    expect(usesLatinVideoPrompt("<Subject 1>: <Picture 1>[วิน in blue plaid]")).toBe(false);
    expect(usesLatinVideoPrompt("[Shot 1] ショット。\n<d>[Thai] ไปกันเถอะ</d>")).toBe(false);
    expect(usesLatinVideoPrompt("Keep the eyeline.\n<d>[Thai] ไปกันเถอะ")).toBe(false);
    expect(usesLatinVideoPrompt("Keep the eyeline.\n<d><d>[Thai] ไปกันเถอะ</d></d>")).toBe(false);
  });

  it("builds shots of the same outfit and maps spatial continuity in 2×2 references", () => {
    const character = characterReferenceSheet("ฟ้า", "almond eyes", "ivory lace");
    expect(character).toContain("TOP RIGHT: true 90-degree right-facing profile");
    expect(character).toContain("Both start just below the chin and end at the floor");
    expect(locationReferenceSheet("รถตู้", "olive seatbacks")).toContain("BOTTOM RIGHT: high-angle spatial overview");
  });
});
