import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { cameraAngleFromDirection, distinctDramaAngles, type DramaCameraAngle } from "../utils/dramaCamera.js";

type NeighborScene = {
  _id: unknown;
  sceneCode: string;
  summary?: string;
  locationId?: unknown;
  timeOfDay?: string;
  dramaBeat?: { entry?: string; exit?: string; openingAngle?: DramaCameraAngle; closingAngle?: DramaCameraAngle };
};

export async function readNeighbor(scene: { episodeId: unknown; order: number }, previous: boolean) {
  const order = previous ? -1 : 1;
  const neighbor = await Scene.findOne({
    episodeId: scene.episodeId,
    order: previous ? { $lt: scene.order } : { $gt: scene.order },
  }).sort({ order }).select("sceneCode summary dramaBeat locationId timeOfDay").lean<NeighborScene>();
  if (!neighbor) return;
  const shot = await Shot.findOne({ sceneId: neighbor._id }).sort({ order })
    .select("camera cameraAngle direction.blocking direction.endBlocking")
    .lean<{ camera?: string; cameraAngle?: DramaCameraAngle; direction?: { blocking?: string; endBlocking?: string } }>();
  const plannedAngle = previous ? neighbor.dramaBeat?.closingAngle : neighbor.dramaBeat?.openingAngle;
  return {
    sceneCode: neighbor.sceneCode,
    locationId: neighbor.locationId,
    timeOfDay: neighbor.timeOfDay,
    summary: neighbor.summary,
    frame: previous ? neighbor.dramaBeat?.exit : neighbor.dramaBeat?.entry,
    endBlocking: previous ? shot?.direction?.endBlocking?.trim() || neighbor.dramaBeat?.exit?.trim() ||
      shot?.direction?.blocking?.trim() : undefined,
    camera: shot?.camera,
    angle: shot?.cameraAngle ?? cameraAngleFromDirection(shot?.camera) ?? plannedAngle,
  };
}

export function continuesFromNeighbor(
  scene: { locationId?: unknown; timeOfDay?: string; dramaBeat?: { entry?: string; continuesPrevious?: boolean } },
  previous: Awaited<ReturnType<typeof readNeighbor>>,
): boolean {
  if (!scene.locationId || !previous?.locationId || String(scene.locationId) !== String(previous.locationId)) return false;
  const currentTime = scene.timeOfDay?.trim().toLowerCase();
  const previousTime = previous.timeOfDay?.trim().toLowerCase();
  if (currentTime && previousTime && currentTime !== previousTime) return false;
  return scene.dramaBeat?.continuesPrevious ??
    !/ข้ามเวลา|วันถัดไป|วันต่อมา|เช้าวันใหม่|เวลาผ่านไป|ย้อนอดีต|time jump|time skip|flashback|the next (day|morning)/iu.test(scene.dramaBeat?.entry ?? "");
}

export async function validateSceneCameraHandoff(
  scene: { episodeId: unknown; order: number; sceneCode: string },
  shots: readonly { cameraAngle?: DramaCameraAngle | null; camera?: string | null }[],
) {
  const first = shots[0];
  const last = shots.at(-1);
  const opening = first?.cameraAngle ?? cameraAngleFromDirection(first?.camera ?? undefined);
  const closing = last?.cameraAngle ?? cameraAngleFromDirection(last?.camera ?? undefined);
  const [previous, next] = await Promise.all([readNeighbor(scene, true), readNeighbor(scene, false)]);
  if (opening && previous?.angle && !distinctDramaAngles(previous.angle, opening)) {
    throw new Error(`มุมเปิดของ ${scene.sceneCode} ใกล้กับมุมปิดของ ${previous.sceneCode} กรุณาเปลี่ยนตำแหน่งกล้องที่รอยต่อ`);
  }
  if (closing && next?.angle && !distinctDramaAngles(closing, next.angle)) {
    throw new Error(`มุมปิดของ ${scene.sceneCode} ใกล้กับมุมเปิดของ ${next.sceneCode} กรุณาเปลี่ยนตำแหน่งกล้องที่รอยต่อ`);
  }
  return previous;
}
