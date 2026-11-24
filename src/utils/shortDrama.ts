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
    shotTimeline(shots).at(-1)?.end === sceneDurationSec;
}

export function alignDramaShotTiming<T extends DramaShot>(shots: T[], sceneDurationSec: number): T[] {
  const adjusted = shots.map(shot => ({ ...shot }));
  const lastFrame = shotTimeline(shots).at(-1)?.end ?? 0;
  let remaining = Math.round((sceneDurationSec - lastFrame) * TICKS_PER_SECOND);
  // Make small timing corrections on silent shots so an approved line keeps its time.
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
  return remaining === 0 ? adjusted : shots;
}
