import { countDramaDialogue } from "./dramaDialogue.js";
import { hasInvalidDramaScenes, isDramaClipDuration } from "./shortDrama.js";

type ProductionScene = {
  _id: unknown;
  dramaBeat?: unknown;
  estDurationSec?: unknown;
  shotsApproved?: unknown;
  clips?: readonly unknown[];
};

type ProductionShot = {
  sceneId?: unknown;
  characterIds?: readonly unknown[];
  dialogue?: readonly unknown[];
};

export function episodeProductionProgress(scenes: readonly ProductionScene[], shots: readonly ProductionShot[]) {
  const hasScenes = scenes.length > 0;
  const scenesReady = hasScenes && !hasInvalidDramaScenes(scenes);
  const hasShots = shots.length > 0;
  const unreviewedDialogue = shots.filter(shot => shot.dialogue?.some(line =>
    !!line && typeof line === "object" && "source" in line && line.source === "generated" &&
    !("reviewed" in line && line.reviewed),
  )).length;

  const dramaScenes = scenes.filter(scene => scene.dramaBeat);
  const shortDrama = dramaScenes.length > 0;
  const dramaSceneIds = new Set(dramaScenes.map(scene => String(scene._id)));
  const approvedDramaSceneIds = new Set(dramaScenes.filter(scene => scene.shotsApproved).map(scene => String(scene._id)));
  const dialogueMissing = shortDrama && hasShots && !countDramaDialogue(shots.filter(shot => dramaSceneIds.has(String(shot.sceneId))));
  const dialogueApproved = !shortDrama || countDramaDialogue(
    shots.filter(shot => approvedDramaSceneIds.has(String(shot.sceneId))), true,
  ) > 0;
  const shotsApproved = hasShots && unreviewedDialogue === 0 &&
    (!shortDrama || (dialogueApproved && scenes.every(scene => scene.shotsApproved)));

  const clipsByScene = scenes.map(scene => ({
    scene,
    clips: (scene.clips ?? []).filter((clip): clip is { durationSec?: unknown; videoPrompt: string } =>
      !!clip && typeof clip === "object" && "videoPrompt" in clip &&
      typeof clip.videoPrompt === "string" && clip.videoPrompt.trim().length > 0 &&
      !("stale" in clip && clip.stale),
    ),
  }));
  const scenesWithClips = clipsByScene.filter(({ clips }) => clips.length > 0).length;
  const clipsHavePrompts = hasScenes && dialogueApproved && scenesWithClips === scenes.length &&
    clipsByScene.every(({ scene, clips }) =>
      !scene.dramaBeat || (clips.length === 1 && isDramaClipDuration(clips[0].durationSec) &&
        clips[0].durationSec === scene.estDurationSec),
    );

  return { hasScenes, scenesReady, hasShots, shotsApproved, dialogueMissing, dialogueApproved,
    unreviewedDialogue, scenesWithClips, clipsHavePrompts };
}

export function episodeProductionStatus(savedStatus: string, progress: ReturnType<typeof episodeProductionProgress>) {
  if (!progress.hasScenes) {
    return savedStatus === "shots_review" || savedStatus === "scenes_review" ? "scenes_pending" : savedStatus;
  }
  if (!progress.scenesReady) return "scenes_replan";
  if (!progress.hasShots) return "shots_pending";
  if (!progress.shotsApproved) return "shots_review";
  if (!progress.clipsHavePrompts) return "prompts_pending";
  return savedStatus === "done" ? "done" : "prompts_ready";
}
