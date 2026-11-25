export const DRAMA_EP_SECONDS = 60;
export const DRAMA_MAX_CLIP_SECONDS = 15;
export const DRAMA_MIN_CLIP_SECONDS = 4;
export const DRAMA_REPLAN_MESSAGE = "แผนนี้มีซีนที่อยู่นอกช่วง 4–15 วินาที กรุณาแบ่งฉากอัตโนมัติใหม่";

const TICKS_PER_SECOND = 10;

type DramaShot = {
  order: number;
  durationSec: number;
  dialogue?: readonly unknown[];
  narration?: string | null;
};

export function shotTimeline(shots: { durationSec: number }[]) {
  let elapsed = 0;
  return shots.map(({ durationSec }) => {
    const start = elapsed / TICKS_PER_SECOND;
    elapsed += Math.round(durationSec * TICKS_PER_SECOND);
    return { start, end: elapsed / TICKS_PER_SECOND };
  });
}

export function isDramaClipDuration(seconds: unknown): seconds is number {
  return typeof seconds === "number" && Number.isInteger(seconds) &&
    seconds >= DRAMA_MIN_CLIP_SECONDS && seconds <= DRAMA_MAX_CLIP_SECONDS;
}

export function minimumDramaSceneCount(episodeDurationSec: number): number {
  return Math.ceil(episodeDurationSec / DRAMA_MAX_CLIP_SECONDS);
}

export function hasInvalidDramaScenes(scenes: readonly { dramaBeat?: unknown; estDurationSec?: unknown }[]): boolean {
  return scenes.some(scene => scene.dramaBeat && !isDramaClipDuration(scene.estDurationSec));
}

export function needsDramaVideoPrompt(scene: {
  dramaBeat?: unknown;
  clips?: readonly { videoPrompt?: string; stale?: boolean }[];
}): boolean {
  return !!scene.dramaBeat && !scene.clips?.some(clip => !clip.stale && clip.videoPrompt?.trim());
}

export function fitsDramaScene(shots: DramaShot[], sceneDurationSec: unknown): boolean {
  return isDramaClipDuration(sceneDurationSec) &&
    shots.length > 0 &&
    shots.every(({ order, durationSec, dialogue }, index) =>
      order === index + 1 && durationSec >= 0.5 && durationSec <= (dialogue?.length ? 7 : 4) &&
      Math.abs(durationSec * TICKS_PER_SECOND - Math.round(durationSec * TICKS_PER_SECOND)) < 1e-8
    ) &&
    Math.abs((shotTimeline(shots).at(-1)?.end ?? 0) - (sceneDurationSec as number)) < 1e-8;
}

export function alignDramaShotTiming<T extends DramaShot>(shots: T[], sceneDurationSec: number): T[] {
  // Pass 0: expand shots whose dialogue is longer than their durationSec
  const expanded = shots.map(shot => {
    if (!shot.dialogue?.length) return shot;
    const speechSec = shot.dialogue.reduce((s: number, line) => {
      const text = typeof line === "object" && line && "lineTh" in line ? String((line as any).lineTh ?? "") : "";
      if (!text || !/[\p{L}\p{N}]/u.test(text)) return s;
      const words = [...new Intl.Segmenter("th", { granularity: "word" }).segment(text)].filter(w => w.isWordLike).length;
      const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
      return s + Math.max(words / 3.5, letters / 14) + 0.25;
    }, 0 as number);
    if ((speechSec as number) <= shot.durationSec) return shot;
    // round up to nearest 0.1s, cap at 7s
    const needed = Math.min(Math.ceil((speechSec as number) * 10) / 10, 7);
    return { ...shot, durationSec: needed };
  });
  const adjusted = expanded.map(shot => ({ ...shot }));
  const lastFrame = shotTimeline(adjusted).at(-1)?.end ?? 0;
  let remaining = Math.round((sceneDurationSec - lastFrame) * TICKS_PER_SECOND);
  // Pass 1: adjust silent shots only
  for (const shot of adjusted) {
    if (remaining === 0) break;
    if (shot.dialogue?.length || shot.narration?.trim() || !Number.isFinite(shot.durationSec)) continue;
    const ticks = Math.round(shot.durationSec * TICKS_PER_SECOND);
    if (ticks < 5 || ticks > 40 || Math.abs(shot.durationSec * TICKS_PER_SECOND - ticks) > 1e-8) continue;
    const correction = remaining > 0
      ? Math.min(remaining, 5, 40 - ticks)
      : Math.max(remaining, -5, 5 - ticks);
    shot.durationSec = (ticks + correction) / TICKS_PER_SECOND;
    remaining -= correction;
  }
  if (remaining === 0) return adjusted;
  // Pass 2: fallback — adjust dialogue shots within their allowed range (0.5–7s)
  for (const shot of adjusted) {
    if (remaining === 0) break;
    if (!Number.isFinite(shot.durationSec)) continue;
    const ticks = Math.round(shot.durationSec * TICKS_PER_SECOND);
    const minTicks = 5;
    const maxTicks = shot.dialogue?.length ? 70 : 40;
    if (ticks < minTicks || ticks > maxTicks) continue;
    const correction = remaining > 0
      ? Math.min(remaining, maxTicks - ticks)
      : Math.max(remaining, minTicks - ticks);
    shot.durationSec = (ticks + correction) / TICKS_PER_SECOND;
    remaining -= correction;
  }
  return remaining === 0 ? adjusted : shots;
}
