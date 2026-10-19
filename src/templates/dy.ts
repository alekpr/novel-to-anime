/**
 * dy.ts — DY Video Prompt Assembler
 *
 * รับ SceneVideoPromptDraft (JSON จาก LLM) + Bible data
 * คืน string ฟอร์แมต DY ต่อ clip พร้อม validator
 */

import type { SceneVideoPromptDraftType, ShotDraftType } from "../schemas/llm.js";
import { splitIntoClips, type ShotForSplit } from "../services/clipSplitter.js";

// ---- Types ----

export type SubjectDef = {
  index: number;                          // 1-based
  role: "location" | "character";
  entityId: string;
  block: string;                          // appearanceBlock / locationBlock
  pictureRef?: number;                    // <Picture N> index
  speakerIndex?: number;                  // (S#) 1-based, เรียงตามลำดับที่พูดใน clip
};

export type ClipContext = {
  clipIndex: number;                      // 0-based
  totalClips: number;
  durationSec: number;
  shots: ShotDraftType[];
  subjects: SubjectDef[];
  referencePictures: Array<{ index: number; description: string }>;
  dialogueLanguage: string;
};

export type DYAssembleInput = {
  draft: SceneVideoPromptDraftType;
  locationId: string;
  locationBlock: string;
  locationName: string;
  characters: Array<{
    id: string;
    appearanceBlock: string;
    name: string;
  }>;
  referencePictures: Array<{ index: number; description: string }>;
  dialogueLanguage: string;
  clipPolicy: { maxClipSec: number; targetClipSec: number; minClipSec: number };
  promptPrefix?: string;
};

export type DYAssembleResult = {
  clips: Array<{ durationSec: number; prompt: string; shotIds: string[] }>;
  validationErrors: string[];
};

// ---- Main assembler ----

export function assembleDY(input: DYAssembleInput): DYAssembleResult {
  const { draft, locationBlock, locationName, characters, referencePictures,
    dialogueLanguage, clipPolicy, promptPrefix = "DY" } = input;

  // แปลง shots เป็น ShotForSplit
  const shotsForSplit: ShotForSplit[] = draft.shots.map((sh, i) => ({
    id: String(i),
    durationSec: sh.durationSec,
    breakQuality: sh.beat.breakQuality,
  }));

  // S4b: แบ่ง clips
  const clipGroups = splitIntoClips(shotsForSplit, clipPolicy);

  const validationErrors: string[] = [];
  const clips: DYAssembleResult["clips"] = [];

  let shotOffset = 0;
  for (let ci = 0; ci < clipGroups.length; ci++) {
    const group = clipGroups[ci];
    const clipShots = draft.shots.slice(shotOffset, shotOffset + group.length);
    shotOffset += group.length;

    const clipDuration = group.reduce((s, sh) => s + sh.durationSec, 0);

    // หา characters ที่ปรากฏใน clip นี้ (ตามลำดับที่ปรากฏครั้งแรก)
    const charIdsInClip = getOrderedCharIds(clipShots);
    const charsInClip = charIdsInClip
      .map((id) => characters.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    // สร้าง subject list: Subject 1 = location, ถัดไป = characters
    const subjects: SubjectDef[] = [
      {
        index: 1,
        role: "location",
        entityId: input.locationId,
        block: locationBlock,
        pictureRef: referencePictures.length > 0 ? 1 : undefined,
      },
      ...charsInClip.map((c, i) => ({
        index: i + 2,
        role: "character" as const,
        entityId: c.id,
        block: c.appearanceBlock,
        pictureRef: referencePictures.length > 1 ? 2 : (referencePictures.length > 0 ? 1 : undefined),
      })),
    ];

    // สร้าง speaker index map (เรียงตามลำดับที่พูดครั้งแรกใน clip)
    const speakerOrder = getSpeakerOrder(clipShots);
    speakerOrder.forEach((charId, idx) => {
      const subj = subjects.find((s) => s.entityId === charId);
      if (subj) subj.speakerIndex = idx + 1;
    });

    // validate
    const errs = validateClip(clipShots, subjects, clipDuration, clipPolicy, referencePictures);
    validationErrors.push(...errs.map((e) => `Clip ${ci + 1}: ${e}`));

    const prompt = buildDYPrompt({
      clipIndex: ci,
      totalClips: clipGroups.length,
      durationSec: clipDuration,
      shots: clipShots,
      subjects,
      referencePictures,
      dialogueLanguage,
    }, draft, locationName, promptPrefix);

    clips.push({
      durationSec: clipDuration,
      prompt,
      shotIds: group.map((_, i) => String(shotOffset - group.length + i)),
    });
  }

  return { clips, validationErrors };
}

// ---- DY prompt builder ----

function buildDYPrompt(
  ctx: ClipContext,
  draft: SceneVideoPromptDraftType,
  locationName: string,
  prefix: string
): string {
  const lines: string[] = [];

  // subject_definitions
  lines.push(`${prefix},subject_definitions:`);
  for (const subj of ctx.subjects) {
    if (subj.role === "location") {
      const picRef = subj.pictureRef ? ` in <Picture ${subj.pictureRef}>` : "";
      lines.push(`<Subject ${subj.index}> is the ${locationName} environment${picRef}, ${subj.block}.`);
    } else {
      const picRef = subj.pictureRef
        ? ` shown in <Picture 1> and in the ${subj.index === 2 ? "left" : "right"} close-up of <Picture ${subj.pictureRef}>`
        : "";
      lines.push(`<Subject ${subj.index}> is the character${picRef}, ${subj.block}.`);
    }
  }

  // summary
  const picDescs = ctx.referencePictures.map((p) => `<Picture ${p.index}> provides ${p.description}`).join("; ");
  const contNote = ctx.clipIndex > 0 ? ` This clip continues directly from clip ${ctx.clipIndex}.` : "";
  lines.push(`\nsummary:`);
  lines.push(`[reference generation] The target is a ${ctx.durationSec}-second ${draft.visualTone} ${draft.sceneType}. ${picDescs}.${contNote} The scene progresses through ${ctx.shots.length} connected shots, with all dialogue performed naturally in ${ctx.dialogueLanguage}.`);

  // retention_analysis
  lines.push(`\nretention_analysis:`);
  for (const subj of ctx.subjects) {
    const shotNums = ctx.shots
      .map((sh, i) => {
        const inShot = subj.role === "location" ||
          sh.charactersInShot.includes(subj.entityId);
        return inShot ? `[Shot ${i + 1}]` : null;
      })
      .filter(Boolean)
      .join(", ");
    const note = draft.retentionNotes[subj.entityId] ?? "consistent appearance throughout";
    lines.push(`<Subject ${subj.index}> (appears in ${shotNums}): fully_preserved - ${note}.`);
  }

  // detailed_description
  lines.push(`\ndetailed_description:`);
  lines.push(draft.visualTone);

  // shots
  let timeMs = 0;
  for (let i = 0; i < ctx.shots.length; i++) {
    const sh = ctx.shots[i];
    const timeStr = i === 0 ? "" : `At ${formatTime(timeMs)}, `;
    const desc = resolveTokens(sh.description, ctx.subjects);
    const dialogueStr = sh.dialogue
      .map((d) => {
        const subj = ctx.subjects.find((s) => s.entityId === d.speakerCharacterId);
        const sNum = subj ? `<Subject ${subj.index}> (S${subj.speakerIndex ?? "?"})` : "?";
        return `${sNum} speaks ${d.tone}: <d>[${ctx.dialogueLanguage}] ${d.text}</d>`;
      })
      .join(" ");
    lines.push(`\n[Shot ${i + 1}] ${timeStr}${desc}${dialogueStr ? " " + dialogueStr : ""}`);
    timeMs += sh.durationSec * 1000;
  }

  // soundscape + music
  lines.push(`\noverall_soundscape:`);
  lines.push(`${draft.soundscape} No subtitles or visible text.`);
  lines.push(`\nnon_diegetic_music:`);
  lines.push(draft.music);

  return lines.join("\n");
}

// ---- Validator ----

function validateClip(
  shots: ShotDraftType[],
  subjects: SubjectDef[],
  durationSec: number,
  policy: { maxClipSec: number; minClipSec: number },
  pictures: Array<{ index: number; description: string }>
): string[] {
  const errors: string[] = [];

  if (durationSec > policy.maxClipSec)
    errors.push(`ความยาว ${durationSec}s เกิน maxClipSec ${policy.maxClipSec}s`);
  if (durationSec < policy.minClipSec && shots.length > 0)
    errors.push(`ความยาว ${durationSec}s น้อยกว่า minClipSec ${policy.minClipSec}s`);

  // ตรวจ <Subject N> ที่ใช้ใน shots ต้องถูกนิยามใน subjects
  const definedSubjects = new Set(subjects.map((s) => s.index));
  for (const sh of shots) {
    const refs = [...sh.description.matchAll(/\{\{char:([^}]+)\}\}|\{\{loc:([^}]+)\}\}/g)];
    for (const ref of refs) {
      const id = ref[1] ?? ref[2];
      const subj = subjects.find((s) => s.entityId === id);
      if (!subj) errors.push(`token {{${ref[0]}}} ใน description ไม่มีใน subjects`);
    }
    for (const d of sh.dialogue) {
      const subj = subjects.find((s) => s.entityId === d.speakerCharacterId);
      if (!subj) errors.push(`speakerCharacterId "${d.speakerCharacterId}" ไม่มีใน subjects`);
      if (!d.text.trim()) errors.push(`dialogue text ว่างเปล่า`);
    }
  }

  // ตรวจ soundscape ต้องมี "No subtitles"
  // (ตรวจใน buildDYPrompt แล้ว เพิ่มอัตโนมัติ)

  // ตรวจ Picture refs ตรงกับจำนวนที่แนบ
  const maxPicRef = Math.max(0, ...subjects.map((s) => s.pictureRef ?? 0));
  if (maxPicRef > pictures.length)
    errors.push(`prompt อ้างถึง <Picture ${maxPicRef}> แต่มีเพียง ${pictures.length} ภาพ`);

  return errors;
}

// ---- Helpers ----

function getOrderedCharIds(shots: ShotDraftType[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const sh of shots) {
    for (const id of sh.charactersInShot) {
      if (!seen.has(id)) { seen.add(id); order.push(id); }
    }
  }
  return order;
}

function getSpeakerOrder(shots: ShotDraftType[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const sh of shots) {
    for (const d of sh.dialogue) {
      if (!seen.has(d.speakerCharacterId)) {
        seen.add(d.speakerCharacterId);
        order.push(d.speakerCharacterId);
      }
    }
  }
  return order;
}

function resolveTokens(text: string, subjects: SubjectDef[]): string {
  return text.replace(/\{\{(char|loc):([^}]+)\}\}/g, (_match, _type, id) => {
    const subj = subjects.find((s) => s.entityId === id);
    return subj ? `<Subject ${subj.index}>` : `[unknown:${id}]`;
  });
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60).toString().padStart(2, "0");
  const sec = (totalSec % 60).toString().padStart(2, "0");
  const msStr = (ms % 1000).toString().padStart(3, "0");
  return `${min}:${sec}.${msStr}`;
}
