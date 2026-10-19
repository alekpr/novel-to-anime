import { describe, it, expect } from "vitest";
import { splitIntoClips, type ShotForSplit, type ClipPolicy } from "../src/services/clipSplitter.js";

const pol: ClipPolicy = { maxClipSec: 15, targetClipSec: 12, minClipSec: 5 };

function shots(durations: number[], qualities?: ("hard" | "soft" | "avoid")[]): ShotForSplit[] {
  return durations.map((d, i) => ({
    id: `s${i + 1}`,
    durationSec: d,
    breakQuality: qualities?.[i] ?? "soft",
  }));
}

describe("splitIntoClips", () => {
  it("returns empty array for empty input", () => {
    expect(splitIntoClips([], pol)).toEqual([]);
  });

  it("scene from plan: 9 shots (6,5,4,7,5,6,5,4,5) → 4 clips ≤ 15s", () => {
    const s = shots([6, 5, 4, 7, 5, 6, 5, 4, 5]);
    const clips = splitIntoClips(s, pol);
    expect(clips.length).toBe(4);
    for (const clip of clips) {
      const total = clip.reduce((sum, sh) => sum + sh.durationSec, 0);
      expect(total).toBeLessThanOrEqual(15);
      expect(total).toBeGreaterThanOrEqual(5);
    }
    // ครอบคลุมทุก shot
    expect(clips.flat().map((s) => s.id)).toEqual(s.map((s) => s.id));
  });

  it("single short scene stays as one clip", () => {
    const s = shots([4, 4]);
    const clips = splitIntoClips(s, pol);
    expect(clips.length).toBe(1);
  });

  it("avoids cutting after 'avoid' shot when possible", () => {
    // shot 1 (6s, avoid) + shot 2 (6s, hard) + shot 3 (6s, hard) = 18s > 15s
    // ต้องตัดหลัง shot 2 ไม่ใช่หลัง shot 1
    const s = shots([6, 6, 6], ["avoid", "hard", "hard"]);
    const clips = splitIntoClips(s, pol);
    expect(clips.length).toBe(2);
    expect(clips[0].length).toBe(2); // shot 1+2 อยู่ด้วยกัน
  });

  it("throws when a single shot exceeds maxClipSec", () => {
    const s = shots([16]);
    expect(() => splitIntoClips(s, pol)).toThrow("maxClipSec");
  });

  it("works with maxClipSec = 20 → fewer clips", () => {
    const pol20: ClipPolicy = { maxClipSec: 20, targetClipSec: 15, minClipSec: 5 };
    const s = shots([6, 5, 4, 7, 5, 6, 5, 4, 5]);
    const clips = splitIntoClips(s, pol20);
    expect(clips.length).toBeLessThan(4);
    for (const clip of clips) {
      const total = clip.reduce((sum, sh) => sum + sh.durationSec, 0);
      expect(total).toBeLessThanOrEqual(20);
    }
  });
});
