export type ShotForSplit = {
  id: string;
  durationSec: number;
  breakQuality: "hard" | "soft" | "avoid";
};

export type ClipPolicy = {
  maxClipSec: number;
  targetClipSec: number;
  minClipSec: number;
};

export function splitIntoClips(shots: ShotForSplit[], pol: ClipPolicy): ShotForSplit[][] {
  if (shots.length === 0) return [];

  const n = shots.length;
  const prefix: number[] = [0];
  for (const sh of shots) prefix.push(prefix[prefix.length - 1] + sh.durationSec);

  const dur = (i: number, j: number) => prefix[j] - prefix[i];
  const cutPenalty = (j: number) => {
    if (j === n) return 0;
    return ({ hard: 0, soft: 6, avoid: 80 } as const)[shots[j - 1].breakQuality];
  };

  const best = Array(n + 1).fill(Infinity) as number[];
  const from = Array(n + 1).fill(-1) as number[];
  best[0] = 0;

  for (let j = 1; j <= n; j++) {
    for (let i = j - 1; i >= 0; i--) {
      const d = dur(i, j);
      if (d > pol.maxClipSec) break;
      if (best[i] === Infinity) continue;
      const short = d < pol.minClipSec && !(i === 0 && j === n) ? 50 : 0;
      const cost = best[i] + (d - pol.targetClipSec) ** 2 + short + cutPenalty(j);
      if (cost < best[j]) { best[j] = cost; from[j] = i; }
    }
  }

  if (!isFinite(best[n])) {
    throw new Error("มี shot ยาวเกิน maxClipSec — ให้ S4a ออกแบบใหม่");
  }

  const clips: ShotForSplit[][] = [];
  let j = n;
  while (j > 0) {
    const i = from[j];
    clips.unshift(shots.slice(i, j));
    j = i;
  }
  return clips;
}
