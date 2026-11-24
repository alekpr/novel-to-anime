import { describe, expect, it } from "vitest";
import { episodeProductionProgress, episodeProductionStatus } from "../src/utils/episodeProduction.js";

const scenes = [
  { _id: "one", dramaBeat: {}, estDurationSec: 10, shotsApproved: true },
  { _id: "two", dramaBeat: {}, estDurationSec: 12, shotsApproved: true },
];
const shots = [
  { sceneId: "one", characterIds: ["lead"], dialogue: [
    { speakerId: "lead", lineTh: "รอด้วย", source: "generated", reviewed: true },
  ] },
  { sceneId: "two", characterIds: [], dialogue: [] },
];
const withPrompts = scenes.map(scene => ({
  ...scene,
  clips: [{ durationSec: scene.estDurationSec, videoPrompt: "Approved prompt", stale: false }],
}));

describe("episode production status", () => {
  it("shows ready video prompts even if the stored episode status is shots_review", () => {
    const progress = episodeProductionProgress(withPrompts, shots);
    expect(progress.shotsApproved).toBe(true);
    expect(progress.scenesWithClips).toBe(2);
    expect(episodeProductionStatus("shots_review", progress)).toBe("prompts_ready");
  });

  it("shows that prompts still need to be made if a saved prompt is stale", () => {
    const [first, second] = withPrompts;
    const withStale = [first, { ...second, clips: [{ ...second.clips[0], stale: true }] }];
    expect(episodeProductionStatus("shots_review", episodeProductionProgress(withStale, shots))).toBe("prompts_pending");
  });

  it("reports shot review when a scene still needs approval or a dialogue line is unreviewed", () => {
    const unapproved = [withPrompts[0], { ...withPrompts[1], shotsApproved: false }];
    expect(episodeProductionStatus("shots_review", episodeProductionProgress(unapproved, shots))).toBe("shots_review");
    const unreviewed = [{ ...shots[0], dialogue: [{ ...shots[0].dialogue[0], reviewed: false }] }, shots[1]];
    expect(episodeProductionStatus("shots_review", episodeProductionProgress(withPrompts, unreviewed))).toBe("shots_review");
  });

  it("distinguishes a scene plan without shots from a plan that exceeds the clip limit", () => {
    expect(episodeProductionStatus("scenes_review", episodeProductionProgress(scenes, []))).toBe("shots_pending");
    const tooLong = [{ ...scenes[0], estDurationSec: 16 }];
    expect(episodeProductionStatus("shots_review", episodeProductionProgress(tooLong, shots))).toBe("scenes_replan");
  });
});
