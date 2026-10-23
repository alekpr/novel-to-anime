import { z } from "zod";

// ---- S1: Story Bible Extraction ----

export const LLMAppearance = z.object({
  hair: z.string().default(""),
  skin: z.string().default(""),
  eyes: z.string().default(""),
  build: z.string().default(""),
  distinguishing: z.string().default(""),
  defaultOutfit: z.string().default(""),
  inferredFields: z.array(z.string()).default([]),
});

export const LLMOutfit = z.object({
  name: z.string(),
  description: z.string(),
  outfitPrompt: z.string().default(""),
  outfitSheetPrompt: z.string().default(""),
});

export const LLMVoice = z.object({
  gender: z.string().default(""),
  ageRange: z.string().default(""),
  pitch: z.string().default(""),
  timbre: z.string().default(""),
  pace: z.string().default(""),
  accent: z.string().default(""),
  defaultEmotion: z.string().default(""),
  speechHabits: z.array(z.string()).default([]),
  sampleLines: z.array(z.string()).default([]),
});

export const LLMCharacter = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  role: z.string().transform((v) => (["main", "support", "extra"].includes(v) ? v : "support")).pipe(z.enum(["main", "support", "extra"])).catch("support"),
  age: z.string().default(""),
  personality: z.string().default(""),
  appearance: LLMAppearance.default({}),
  outfits: z.array(LLMOutfit).default([]),
  voice: LLMVoice.default({}),
  appearanceBlock: z.string().default(""),
  characterSheetPrompt: z.string().default(""),
  voicePrompt: z.string().default(""),
  needsReview: z.boolean().default(false),
  needsReviewReason: z.string().default(""),
});

export const LLMLocation = z.object({
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  type: z.string().transform((v) => (v === "exterior" ? "exterior" : "interior")).pipe(z.enum(["interior", "exterior"])).catch("interior"),
  description: z.string().default(""),
  timeOfDay: z.string().default(""),
  lighting: z.string().default(""),
  weather: z.string().default(""),
  materials: z.string().default(""),
  keyElements: z.array(z.string()).default([]),
  mood: z.string().default(""),
  locationBlock: z.string().default(""),
  masterPrompt: z.string().default(""),
  relatedCharacterNames: z.array(z.string()).default([]),
  needsReview: z.boolean().default(false),
});

export const BibleExtractionResult = z.object({
  characters: z.array(LLMCharacter),
  locations: z.array(LLMLocation),
  episodeSummary: z.string().default(""),
});

export type BibleExtractionResultType = z.infer<typeof BibleExtractionResult>;
export type LLMCharacterType = z.infer<typeof LLMCharacter>;
export type LLMLocationType = z.infer<typeof LLMLocation>;

// ---- S2: Scene Breakdown ----

export const LLMScene = z.object({
  order: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  locationName: z.string().default(""),
  locationId: z.string().default(""),   // CHAR_N / LOC_N index from prompt
  timeOfDay: z.string().default(""),
  mood: z.string().default(""),
  characterNames: z.array(z.string()).default([]),
  characterIds: z.array(z.string()).default([]),  // CHAR_N indexes
  fromParagraph: z.number().int().min(0),
  toParagraph: z.number().int().min(0),
  estDurationSec: z.number().positive().default(30),
});

export const SceneBreakdownResult = z.object({
  scenes: z.array(LLMScene).min(1),
});

export type LLMSceneType = z.infer<typeof LLMScene>;

// ---- S3: Shot List + Dialogue ----

export const LLMDialogueLine = z.object({
  speakerName: z.string(),
  lineTh: z.string(),
  tone: z.string().default(""),
  source: z.string().transform((v) => (v === "generated" ? "generated" : "original")).pipe(z.enum(["original", "generated"])).catch("original"),
});

export const LLMShot = z.object({
  order: z.number().int().positive(),
  shotType: z.string().transform((v) => (["wide", "medium", "close-up", "OTS", "insert", "POV"].includes(v) ? v : "medium")).pipe(z.enum(["wide", "medium", "close-up", "OTS", "insert", "POV"])).catch("medium"),
  camera: z.union([z.string(), z.null()]).transform(v => v ?? "").pipe(z.string()).catch(""),
  durationSec: z.number().min(1).max(20).default(4),
  breakQuality: z.string().transform((v) => (["hard", "soft", "avoid"].includes(v) ? v : "soft")).pipe(z.enum(["hard", "soft", "avoid"])).catch("soft"),
  characterNames: z.array(z.string()).catch([]),
  action: z.union([z.string(), z.null()]).transform(v => v ?? "").pipe(z.string()).catch(""),
  emotion: z.union([z.string(), z.null()]).transform(v => v ?? "").pipe(z.string()).catch(""),
  dialogue: z.array(LLMDialogueLine).default([]),
  narration: z.union([z.string(), z.null()]).nullable().default(null),
  sfx: z.union([z.string(), z.null()]).transform(v => v ?? "").pipe(z.string()).catch(""),
  music: z.union([z.string(), z.null()]).transform(v => v ?? "").pipe(z.string()).catch(""),
});

export const ShotListResult = z.object({
  shots: z.array(LLMShot).min(1),
  sceneSummary: z.string().default(""),
});

export type LLMShotType = z.infer<typeof LLMShot>;

// ---- S4a: Scene Video Prompt Draft ----

export const DialogueLine4a = z.object({
  speakerCharacterId: z.string(),
  tone: z.string(),
  text: z.string().min(1),
});

export const ShotDraft = z.object({
  durationSec: z.number().min(1).max(20),
  beat: z.object({
    breakQuality: z.string().transform((v) => (["hard", "soft", "avoid"].includes(v) ? v : "soft")).pipe(z.enum(["hard", "soft", "avoid"])).catch("soft"),
    note: z.string().optional(),
  }),
  camera: z.string(),
  description: z.string(),
  dialogue: z.array(DialogueLine4a).max(4).default([]),
  charactersInShot: z.array(z.string()),
});

export const SceneVideoPromptDraft = z.object({
  title: z.string(),
  sceneType: z.string(),
  summary: z.string(),
  visualTone: z.string(),
  shots: z.array(ShotDraft).min(1),
  retentionNotes: z.record(z.string(), z.string()),
  soundscape: z.string(),
  music: z.string(),
});

export type SceneVideoPromptDraftType = z.infer<typeof SceneVideoPromptDraft>;
export type ShotDraftType = z.infer<typeof ShotDraft>;
export type DialogueLine4aType = z.infer<typeof DialogueLine4a>;
