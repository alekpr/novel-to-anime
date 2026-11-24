import { z } from "zod";
import { callStructured, GeminiRequestError, LLMOutputValidationError, LLMRequestError } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { episodeParagraphs, storySectionsForEpisodes } from "../utils/storyParagraphs.js";
import { isSpokenLine } from "../utils/dramaDialogue.js";

export type StorySource = {
  mode: "story" | "outline";
  text: string;
  episodeCount: number;
};

export class ProjectStoryError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

const storyGenre = z.string().trim().min(1);

const storyPlan = z.object({
  genre: storyGenre,
  episodes: z.array(z.object({
    title: z.string().trim().min(1),
    endSection: z.number().int().positive(),
  })),
});

const outlineDrafts = z.object({
  genre: storyGenre,
  episodes: z.array(z.object({
    title: z.string().trim().min(1),
    beats: z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("action"), text: z.string().trim().min(1) }),
      z.object({ type: z.literal("dialogue"), speaker: z.string().trim().min(1), text: z.string().trim().min(1) }),
    ])).min(1),
  })),
}).superRefine(({ episodes }, ctx) => {
  episodes.forEach(({ beats }, index) => {
    if (!beats.some(beat => beat.type === "dialogue" && isSpokenLine(beat.speaker) && isSpokenLine(beat.text))) {
      ctx.addIssue({ code: "custom", path: ["episodes", index, "beats"], message:
        "Every episode needs at least one dialogue beat with a named speaker and an actual spoken line." });
    }
  });
});

type InitialEpisode = { number: number; title: string; paragraphs: ReturnType<typeof episodeParagraphs> };
type PreparedStory = { genre: string; drafts: InitialEpisode[] };

async function divideStory(title: string, language: string, source: StorySource, genre?: string): Promise<PreparedStory> {
  const sections = storySectionsForEpisodes(source.text, source.episodeCount);
  if (sections.length < source.episodeCount) {
    throw new ProjectStoryError(422, "ต้นฉบับมีช่วงข้อความไม่พอกับจำนวนตอนที่ระบุ ลองลดจำนวนตอนหรือเพิ่มเนื้อเรื่อง");
  }
  const { data } = await callStructured({
    system: loadPrompt("project-story.txt"),
    user: JSON.stringify({
      mode: source.mode, title, language, genre: genre ?? null, episodeCount: source.episodeCount,
      sections: sections.map((text, index) => ({ number: index + 1, text })),
    }),
    schema: storyPlan.refine(({ episodes }) =>
      episodes.length === source.episodeCount &&
      episodes.every((episode, i) => episode.endSection > (episodes[i - 1]?.endSection ?? 0)) &&
      episodes.at(-1)?.endSection === sections.length,
    `Return exactly ${source.episodeCount} episodes with strictly increasing endSection values. The last endSection must be ${sections.length}.`),
    temperature: 0.2,
  });
  const drafts = data.episodes.map((episode, index) => ({
    number: index + 1,
    title: episode.title,
    paragraphs: sections.slice(data.episodes[index - 1]?.endSection ?? 0, episode.endSection)
      .map((text, idx) => ({ idx, text })),
  }));
  return { genre: genre ?? data.genre, drafts };
}

export async function prepareProjectEpisodes(title: string, language: string, source: StorySource, genre?: string): Promise<PreparedStory> {
  try {
    if (source.mode === "story") return await divideStory(title, language, source, genre);
    const { data } = await callStructured({
      system: loadPrompt("project-story.txt"),
      user: JSON.stringify({ title, language, genre: genre ?? null, ...source }),
      schema: outlineDrafts.refine(
        ({ episodes }) => episodes.length === source.episodeCount,
        `Return exactly ${source.episodeCount} episode drafts.`,
      ),
      temperature: 0.5,
    });
    const drafts = data.episodes.map((episode, index) => ({
      number: index + 1,
      title: episode.title,
      paragraphs: episode.beats.map((beat, idx) => ({
        idx,
        text: beat.type === "dialogue" ? `${beat.speaker}: “${beat.text}”` : beat.text,
      })),
    }));
    return { genre: genre ?? data.genre, drafts };
  } catch (error) {
    if (error instanceof ProjectStoryError) throw error;
    if (error instanceof LLMRequestError) {
      if (error.status === 422) throw new ProjectStoryError(422, "AI ไม่สามารถประมวลผลเนื้อเรื่องนี้ได้");
      throw new ProjectStoryError(error.status === 429 ? 429 : 502, error.message);
    }
    const status = error instanceof GeminiRequestError ? error.status :
      error && typeof error === "object" && "status" in error ? error.status : undefined;
    if (status === 429) throw new ProjectStoryError(429, "AI จำกัดโควตาชั่วคราว กรุณาลองใหม่ภายหลัง");
    if (error instanceof LLMOutputValidationError) {
      throw new ProjectStoryError(502, "AI จัดตอนให้ครบตามจำนวนและรูปแบบบทละครไม่สำเร็จ กรุณาลองอีกครั้ง");
    }
    throw new ProjectStoryError(502, "วางตอนด้วย AI ไม่สำเร็จ กรุณาตรวจการตั้งค่า AI แล้วลองอีกครั้ง");
  }
}
