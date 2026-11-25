import { describe, expect, it } from "vitest";
import { countDramaDialogue, dramaSpeechSeconds, isSpokenLine, matchScriptedDramaDialogue, scriptedDramaDialogue } from "../src/utils/dramaDialogue.js";

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

  it("requires the complete accusation after the father's question", () => {
    const source = scriptedDramaDialogue([
      { idx: 12, text: "ประตูร้านเปิดแรง" },
      { idx: 13, text: "**พ่อ:** นี่มันเรื่องอะไรกัน! แขกรอกันหมดแล้ว เฟิร์นอยู่ไหน!" },
      { idx: 14, text: "**นนท์:** คุณอาถามคนนี้เลยครับ มันเป็นคนพาเจ้าสาวของผมหนี" },
    ]);
    expect(source.map(turn => turn.idx)).toEqual([13, 14]);
    expect(dramaSpeechSeconds(source)).toBeGreaterThan(8);
    expect(dramaSpeechSeconds(source)).toBeLessThan(10);
    expect(matchScriptedDramaDialogue(source, source.slice(0, 1))).toBeUndefined();
    expect(matchScriptedDramaDialogue(source, [source[0], { speaker: "นนท์", lineTh: "มันเป็นคนพาเจ้าสาวของผมหนี" }])).toBeUndefined();
    expect(matchScriptedDramaDialogue(source, [
      source[0], { speaker: "นนท์", lineTh: "คุณอาถามคนนี้เลยครับ" }, { speaker: "นนท์", lineTh: "มันเป็นคนพาเจ้าสาวของผมหนี" },
    ])).toEqual([{ start: 0, end: 0 }, { start: 1, end: 2 }]);
  });

  it("keeps scene notes and episode endings out of the spoken transcript", () => {
    expect(scriptedDramaDialogue([
      { idx: 10, text: "**สถานที่:** ร้านดอกไม้ / บ้านเพื่อนเฟิร์น • กลางวัน  \n**อารมณ์:** ปะทะ กดดัน" },
      { idx: 13, text: "**พ่อ:** เฟิร์นอยู่ไหน!" },
      { idx: 39, text: "**จบตอน:** ค้างใบหน้าพ่อที่เริ่มสั่นไหว ตัดดำ" },
      { idx: 40, text: "**Time of day:** Afternoon\n**Mood:** Tense" },
    ])).toEqual([{ idx: 13, speaker: "พ่อ", lineTh: "เฟิร์นอยู่ไหน!" }]);
  });
});
