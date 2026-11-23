import { describe, expect, it } from "vitest";
import { episodeBibleSelector } from "../src/utils/episodeBible.js";

const entries = [
  { _id: "returning", name: "นลิน", episodes: [1] },
  { _id: "shorter-name", name: "นล", episodes: [1] },
  { _id: "linked", name: "ทางเดิน", episodes: [2] },
  { _id: "scene-reference", name: "ดาดฟ้า", episodes: [1] },
  { _id: "first-appearance", name: "ไท", firstAppearanceEp: 2 },
  { _id: "other-episode", name: "ร้านกาแฟ", episodes: [1] },
];
const episode = { number: 2, paragraphs: [{ text: "นลิน: ไปกันเถอะ" }] };

describe("episode Bible membership", () => {
  it("recovers returning characters from an analyzed episode and keeps explicit links", () => {
    const select = episodeBibleSelector({ ...episode, status: "bible_review" });
    expect(select(entries, new Set()).map(entry => entry._id)).toEqual(["returning", "linked", "first-appearance"]);
  });

  it("keeps locations referenced by saved scenes even if the script describes them indirectly", () => {
    const select = episodeBibleSelector({ ...episode, status: "scenes_review" });
    expect(select(entries, new Set(["scene-reference"])).map(entry => entry._id)).toContain("scene-reference");
  });

  it("requires analysis for text fallback in a newly imported episode", () => {
    const select = episodeBibleSelector({ ...episode, status: "ingested" });
    expect(select(entries, new Set()).map(entry => entry._id)).toEqual(["linked", "first-appearance"]);
  });
});
