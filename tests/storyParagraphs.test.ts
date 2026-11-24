import { describe, expect, it } from "vitest";
import { episodeParagraphs, storySectionsForEpisodes } from "../src/utils/storyParagraphs.js";

describe("project story sections", () => {
  it("keeps paragraph boundaries and normalizes Windows line endings", () => {
    expect(episodeParagraphs("บทสนทนา\r\nต่อบรรทัด\r\n \r\nเหตุการณ์ถัดไป")).toEqual([
      { idx: 0, text: "บทสนทนา\nต่อบรรทัด" },
      { idx: 1, text: "เหตุการณ์ถัดไป" },
    ]);
  });

  it("gives unpunctuated Thai prose break candidates without losing words", () => {
    const story = "เมื่อตัวละครกลับมาถึงบ้านเพื่อนทุกคนก็ออกมารอรับเธอที่หน้าประตู";
    const sections = storySectionsForEpisodes(story, 3);
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.join("")).toBe(story);
  });
});
