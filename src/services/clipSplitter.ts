import { distinctDramaAngles, type DramaCameraAngle } from "../utils/dramaCamera.js";

export type ShotForSplit = {
  id: string;
  durationSec: number;
  breakQuality: "hard" | "soft" | "avoid";
  cameraAngle?: DramaCameraAngle;
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
    const outgoing = shots[j - 1].cameraAngle;
    const incoming = shots[j]?.cameraAngle;
    if (outgoing && incoming && !distinctDramaAngles(outgoing, incoming)) continue;
    for (let i = j - 1; i >= 0; i--) {
      const d = dur(i, j);
      if (d > pol.maxClipSec) break;
      if (best[i] === Infinity) continue;
      const short = d < pol.minClipSec && !(i === 0 && j === n) ? 50 : 0;
      const cost = best[i] + (d - pol.targetClipSec) ** 2 + short + cutPenalty(j);
      if (cost < best[j]) { best[j] = cost; from[j] = i; }
    }
  }

  if (!Number.isFinite(best[n])) {
    if (shots.some(shot => shot.durationSec > pol.maxClipSec)) {
      throw new Error("แบ่งคลิปตาม maxClipSec ไม่ได้ กรุณาปรับช็อตที่ยาวเกินเพดานแล้วลองอีกครั้ง");
    }
    throw new Error("แบ่งคลิปให้มุมเปิดต่างจากมุมปิดคลิปก่อนหน้าไม่ได้ กรุณาปรับมุมกล้องที่จุดตัดแล้วลองอีกครั้ง");
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
