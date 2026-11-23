import { describe, expect, it } from "vitest";
import { assembleShortDramaH3 } from "../src/templates/shortDramaH3.js";
import { characterReferenceSheet, locationReferenceSheet } from "../src/templates/referenceSheet.js";
import { DRAMA_EP_SECONDS, alignDramaShotTiming, fitsDramaScene, hasInvalidDramaScenes, minimumDramaSceneCount } from "../src/utils/shortDrama.js";

describe("Thai short drama", () => {
  it("keeps the one-minute default and rejects invalid shot timing", () => {
    const durations = [0.6, 2.3, 5.4, 2.8, 2.9, 1];
    const shots = durations.map((durationSec, index) => ({
      order: index + 1, durationSec, dialogue: index === 2 ? ["บทพูด"] : [],
    }));
    expect(DRAMA_EP_SECONDS).toBe(60);
    expect(fitsDramaScene(shots, 15)).toBe(true);
    expect(fitsDramaScene(shots.map(shot => ({ ...shot, dialogue: [] })), 15)).toBe(false);
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
      shots: [{ durationSec: 2.4, direction: "CU.", dialogue: [] }, { durationSec: 3.6, direction: "Reverse.", dialogue: [] }],
    });
    expect(prompt).toMatch(/^6 seconds, vertical/);
    expect(prompt).toContain("[Shot 2] 00:02.400–00:06.000.");
    expect(prompt).toContain("End at 00:06.000.");
  });

  it("binds Thai lines to speaker order independently of picture order", () => {
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
        { durationSec: 4.4, direction: "Cut to Fah.", dialogue: [{ subject: 2, text: "ออกเลยค่ะ", tone: "Soft" }] },
        { durationSec: 6, direction: "Reverse to Win.", dialogue: [{ subject: 1, text: "จะไปไหนครับ?", tone: "Curious" }] },
        { durationSec: 4, direction: "Cut to Fah.", dialogue: [{ subject: 2, text: "เดี๋ยวบอกค่ะ", tone: "Direct" }] },
      ],
    });
    expect(references.map(ref => [ref.index, ref.name])).toEqual([[1, "วิน"], [2, "ฟ้า"], [3, "รถตู้"]]);
    expect(prompt).toContain("<Subject 2>: <Picture 2>[Fah in the ivory gown]");
    expect(prompt).toContain("S1 is ฟ้า, <Subject 2>. Speaks only in Shot 2, 4.");
    expect(prompt).toContain("<Subject 1> (S2): <d>[Thai] จะไปไหนครับ?</d>");
    expect(prompt).toContain("[Shot 2] 00:00.600–00:05.000.");
    expect(prompt).toContain("[Shot 4] 00:11.000–00:15.000.");
    expect(prompt).toContain("BACKGROUND ACTIVITY, SOUND AND EDITING");
  });

  it("builds shots of the same outfit and maps spatial continuity in 2×2 references", () => {
    const character = characterReferenceSheet("ฟ้า", "almond eyes", "ivory lace");
    expect(character).toContain("TOP RIGHT: true 90-degree right-facing profile");
    expect(character).toContain("Both start just below the chin and end at the floor");
    expect(locationReferenceSheet("รถตู้", "olive seatbacks")).toContain("BOTTOM RIGHT: high-angle spatial overview");
  });
});
