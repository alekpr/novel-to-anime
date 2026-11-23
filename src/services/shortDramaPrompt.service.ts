import { z } from "zod";
import type { Types } from "mongoose";
import { callStructured } from "../llm/client.js";
import { loadPrompt } from "../llm/prompts.js";
import { Character } from "../models/Character.js";
import { Location } from "../models/Location.js";
import { Scene } from "../models/Scene.js";
import { Shot } from "../models/Shot.js";
import { assembleShortDramaH3 } from "../templates/shortDramaH3.js";
import { DRAMA_REPLAN_MESSAGE, fitsDramaScene, isDramaClipDuration } from "../utils/shortDrama.js";
import { countDramaDialogue } from "../utils/dramaDialogue.js";
import { characterImageKey, locationImageKey, outfitImageKeys } from "../utils/imageReferenceKeys.js";

const DirectionText = z.string().trim().min(1);
const VisualDirection = z.object({
  overview: DirectionText,
  blocking: DirectionText,
  soundAndEditing: DirectionText,
  shots: z.array(z.object({ order: z.number().int(), direction: DirectionText })),
});

export type DramaScene = {
  _id: Types.ObjectId;
  episodeId: Types.ObjectId;
  updatedAt: Date;
  sceneCode: string;
  order: number;
  title?: string;
  estDurationSec?: number;
  summary?: string;
  mood?: string;
  timeOfDay?: string;
  locationId?: Types.ObjectId;
  characterIds: Types.ObjectId[];
  shotsApproved?: boolean;
  clips: { promptVersion?: number }[];
  dramaBeat?: {
    entry: string;
    exit: string;
    dialoguePurpose?: string;
    supportingLocationIds?: Types.ObjectId[];
    wardrobe?: { characterId: Types.ObjectId; outfit: string }[];
  };
};
type CharacterReference = {
  _id: Types.ObjectId;
  name: string;
  appearanceBlock?: string;
  appearance?: { defaultOutfit?: string };
  outfits?: { name: string; outfitPrompt?: string; description?: string }[];
  voice?: { pitch?: string; timbre?: string; accent?: string };
};
type ApprovedShot = {
  _id: Types.ObjectId;
  shotCode: string;
  order: number;
  durationSec: number;
  camera?: string;
  action?: string;
  emotion?: string;
  direction?: { blocking: string; performance: string; cut: string; backgroundActivity: string };
  sfx?: string;
  music?: string;
  characterIds: Types.ObjectId[];
  dialogue: { speakerId?: Types.ObjectId; lineTh?: string; tone?: string; reviewed?: boolean }[];
};

export async function runShortDramaPrompt(scene: DramaScene) {
  const sceneDurationSec = scene.estDurationSec;
  if (!isDramaClipDuration(sceneDurationSec)) throw new Error(DRAMA_REPLAN_MESSAGE);
  if (!scene.dramaBeat || !scene.shotsApproved) {
    throw new Error("อนุมัติ All ของซีนในหน้า Shots ก่อนสร้างพรอมป์");
  }

  const beat = scene.dramaBeat;
  const locationIds = [scene.locationId, ...(beat.supportingLocationIds ?? [])].filter(Boolean);
  const [characters, locations, shots, earlierScenes] = await Promise.all([
    Character.find({ _id: { $in: scene.characterIds }, status: "approved" }).lean<CharacterReference[]>(),
    Location.find({ _id: { $in: locationIds }, status: "approved" }).lean<Array<{ _id: Types.ObjectId; name: string; locationBlock?: string; description?: string }>>(),
    Shot.find({ sceneId: scene._id }).sort({ order: 1 }).lean<ApprovedShot[]>(),
    Scene.find({ episodeId: scene.episodeId, order: { $lt: scene.order } })
      .select("estDurationSec").lean<{ estDurationSec?: number }[]>(),
  ]);
  if (!fitsDramaScene(shots, sceneDurationSec) || shots.some(shot => !shot.direction || shot.dialogue.some(line => !line.reviewed))) {
    throw new Error("ตรวจเวลารวมของช็อตและอนุมัติบทพูดของซีนอีกครั้ง");
  }
  if (beat.dialoguePurpose && !countDramaDialogue(shots, true)) {
    throw new Error("ซีนนี้ต้องมีบทพูดที่ผ่านการอนุมัติก่อนสร้างพรอมป์");
  }
  const sceneStartSec = earlierScenes.reduce((sum, earlier) => sum + (earlier.estDurationSec ?? 0), 0);
  const charactersById = new Map(characters.map(c => [c._id.toString(), c]));
  const locationsById = new Map(locations.map(l => [l._id.toString(), l]));
  const subjectForCharacter = new Map<string, number>();

  const references: Parameters<typeof assembleShortDramaH3>[0]["references"] = scene.characterIds.map((id, i) => {
    const character = charactersById.get(id.toString());
    if (!character) throw new Error("มีตัวละครในซีนที่ยังไม่อนุมัติ");
    subjectForCharacter.set(id.toString(), i + 1);
    const chosen = beat.wardrobe?.find(entry => entry.characterId?.equals(id));
    const outfit = chosen ? character.outfits?.find(item => item.name === chosen.outfit) : character.outfits?.[0];
    if (chosen && !outfit) throw new Error(`ไม่พบชุด ${chosen.outfit} ของ ${character.name} ใน Bible`);
    const characterId = id.toString();
    return {
      name: outfit?.name ? `${character.name} · ${outfit.name}` : character.name,
      role: "character",
      resourceKey: outfit
        ? outfitImageKeys({ ...character, _id: characterId })[character.outfits!.indexOf(outfit)]
        : characterImageKey(characterId),
      description: [character.name, character.appearanceBlock, outfit?.outfitPrompt || outfit?.description || character.appearance?.defaultOutfit].filter(Boolean).join(". "),
    };
  });

  for (const id of locationIds) {
    const location = locationsById.get(String(id));
    if (!location) throw new Error("มีสถานที่ในซีนที่ยังไม่อนุมัติ");
    references.push({ name: location.name, role: "location", resourceKey: locationImageKey(String(id)),
      description: `${location.name}. ${location.locationBlock || location.description || ""}` });
  }

  const approvedShots = shots.map(shot => ({
    order: shot.order,
    durationSec: shot.durationSec,
    camera: shot.camera,
    action: shot.action,
    emotion: shot.emotion,
    direction: shot.direction,
    sfx: shot.sfx,
    music: shot.music,
    cast: shot.characterIds.map(id => subjectForCharacter.get(id.toString())).filter(Boolean),
    dialogue: shot.dialogue.map(line => {
      const speakerId = line.speakerId?.toString() ?? "";
      const subject = subjectForCharacter.get(speakerId);
      if (!subject || !line.lineTh?.trim() || !shot.characterIds.some(id => id.toString() === speakerId) ||
          shot.dialogue.some(other => other.speakerId?.toString() !== speakerId)) {
        throw new Error(`ตรวจผู้พูดของ ${shot.shotCode}`);
      }
      const voice = charactersById.get(speakerId)?.voice;
      const tone = [voice?.accent, voice?.pitch, voice?.timbre, line.tone].filter(Boolean).join(". ");
      return { subject, text: line.lineTh, tone };
    }),
  }));

  const { data } = await callStructured({
    system: loadPrompt("s4-short-drama.txt"),
    user: JSON.stringify({
      title: scene.title, summary: scene.summary, mood: scene.mood, timeOfDay: scene.timeOfDay,
      durationSec: sceneDurationSec, opening: beat.entry, ending: beat.exit,
      references: references.map(({ name, role, description }, i) => ({ subject: i + 1, name, role, description })),
      shots: approvedShots.map(shot => ({
        ...shot,
        dialogue: shot.dialogue.map(({ subject, tone }) => ({ subject, tone })),
      })),
    }),
    schema: VisualDirection.refine(
      result => result.shots.length === shots.length && result.shots.every((shot, i) => shot.order === shots[i].order),
      "Return exactly one direction per shot in the supplied scene order.",
    ),
    temperature: 0.2,
  });

  const { prompt, references: referenceSlots } = assembleShortDramaH3({
    overview: data.overview,
    blocking: data.blocking,
    soundAndEditing: data.soundAndEditing,
    references,
    shots: approvedShots.map((shot, i) => ({ ...shot, direction: data.shots[i].direction })),
  });
  const clip = {
    clipCode: `${scene.sceneCode}-C01`,
    shotIds: shots.map(shot => shot._id),
    startOffsetSec: sceneStartSec,
    durationSec: sceneDurationSec,
    videoPrompt: prompt,
    referenceSlots,
    promptVersion: (scene.clips[0]?.promptVersion ?? 0) + 1,
    stale: false,
  };

  const result = await Scene.updateOne(
    { _id: scene._id, updatedAt: scene.updatedAt, shotsApproved: true },
    {
      $set: { clips: [clip], totalDurationSec: sceneDurationSec, "dramaBeat.clipDurationsSec": [sceneDurationSec] },
      $unset: { videoPromptDraft: "" },
    },
  );
  if (!result.matchedCount) throw new Error("ซีนเปลี่ยนระหว่างสร้างพรอมป์ กรุณาตรวจและสร้างอีกครั้ง");

  return { clips: [{ durationSec: sceneDurationSec, prompt }], validationErrors: [] };
}
