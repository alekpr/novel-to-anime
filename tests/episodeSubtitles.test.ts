import { describe, expect, it } from "vitest";
import { buildEpisodeSubtitles } from "../src/utils/episodeSubtitles.js";

describe("episode subtitle export", () => {
  it("combines the spoken lines in scene and clip order using the episode timeline", () => {
    const { text, cueCount } = buildEpisodeSubtitles([
      {
        sceneCode: "EP02-S01",
        clips: [
          {
            clipCode: "EP02-S01-C01", durationSec: 4.5,
            videoPrompt: [
              "[Shot 1] 00:00.000–00:01.250. Silent opening.",
              "[Shot 2] 00:01.250–00:04.500. Close-up.",
              "<Subject 1> (S1) says in a soft voice: <d>[Thai] ไปกันเถอะ</d>",
              "<Subject 1> (S1) says: <d>[English] Let's go.</d>",
            ].join("\n"),
          },
          { clipCode: "EP02-S01-C02", durationSec: 3, videoPrompt: "[Shot 1] 00:00.000–00:03.000. Silent reaction." },
        ],
      },
      {
        sceneCode: "EP02-S02",
        clips: [{
          clipCode: "EP02-S02-C01", durationSec: 5,
          videoPrompt: "[Shot 1] An opening. <d>[Japanese] おはよう。</d>\n\n[Shot 2] At 00:02.300, a reply. <d>[Thai] อรุณสวัสดิ์</d>",
        }],
      },
    ]);
    expect(cueCount).toBe(3);
    expect(text).toBe([
      "1", "00:00:01,250 --> 00:00:04,500", "ไปกันเถอะ", "Let's go.", "",
      "2", "00:00:07,500 --> 00:00:09,800", "おはよう。", "",
      "3", "00:00:09,800 --> 00:00:12,500", "อรุณสวัสดิ์", "",
    ].join("\r\n"));
  });

  it("identifies scenes that need current prompts instead of exporting a partial episode", () => {
    expect(() => buildEpisodeSubtitles([
      { sceneCode: "EP02-S01", clips: [{ clipCode: "EP02-S01-C01", durationSec: 4, videoPrompt: "Old prompt", stale: true }] },
      { sceneCode: "EP02-S02", clips: [] },
    ])).toThrow("EP02-S01, EP02-S02");
  });

  it("identifies the clip when a spoken shot has no usable end time", () => {
    expect(() => buildEpisodeSubtitles([{
      sceneCode: "EP02-S01",
      clips: [{
        clipCode: "EP02-S01-C01", durationSec: 4,
        videoPrompt: "[Shot 1] <d>[Thai] ทดสอบ</d>\n[Shot 2] Missing timestamp.",
      }],
    }])).toThrow("EP02-S01-C01");
  });
});
