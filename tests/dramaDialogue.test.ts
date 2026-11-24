import { describe, expect, it } from "vitest";
import { countDramaDialogue, dramaSpeechSeconds, isSpokenLine } from "../src/utils/dramaDialogue.js";

describe("short drama dialogue", () => {
  it("recognizes words and ignores ellipses, pauses, and empty text", () => {
    expect(isSpokenLine("เธอไม่ต้องรอฉัน")).toBe(true);
    expect(isSpokenLine("… !")).toBe(false);
    expect(isSpokenLine("    ")).toBe(false);
  });

  it("counts reviewed spoken lines attributed to a character visible in the shot", () => {
    const shots = [{ characterIds: ["lead"], dialogue: [
      { speakerId: "lead", lineTh: "เดี๋ยวฉันพูดเอง", reviewed: true },
      { speakerId: "lead", lineTh: "ไปก่อนเลย", reviewed: false },
      { speakerId: "other", lineTh: "รอฉันด้วย", reviewed: true },
      { lineTh: "ใครอยู่ตรงนั้น", reviewed: true },
      { speakerId: "lead", lineTh: "…", reviewed: true },
    ] }];
    expect(countDramaDialogue(shots)).toBe(2);
    expect(countDramaDialogue(shots, true)).toBe(1);
    expect(countDramaDialogue([{ characterIds: ["lead"], dialogue: [] }], true)).toBe(0);
  });

  it("measures unspaced Thai dialogue against the time available for speech", () => {
    expect(dramaSpeechSeconds([{ lineTh: "ไปก่อน" }])).toBeLessThan(1.5);
    expect(dramaSpeechSeconds([{ lineTh: "ฉันคิดว่าคงต้องอธิบายให้คุณฟังตั้งแต่แรกว่าเมื่อวานเกิดอะไรขึ้นบ้าง" }])).toBeGreaterThan(4);
    expect(dramaSpeechSeconds([{ lineTh: "..." }])).toBe(0);
  });
});
