import { shotTimeline } from "../utils/shortDrama.js";
import { cameraSetupDirection, type CameraSetup, type DramaCameraAngle } from "../utils/dramaCamera.js";
import type { VideoReferenceSlot } from "../utils/videoClipInputs.js";
import { clipOpeningContinuity } from "./clipOpening.js";

type Reference = Omit<VideoReferenceSlot, "index"> & { description: string };
type Dialogue = { subject: number; text: string; language: string; delivery: string; actionDuringSpeech?: string };
type DirectedShot = {
  durationSec: number;
  cameraAngle?: DramaCameraAngle;
  cameraSetup?: CameraSetup;
  direction: string;
  portraitFraming?: string;
  propSubjects?: number[];
  dialogue: Dialogue[];
};

function timecode(seconds: number) {
  return `00:${seconds.toFixed(3).padStart(6, "0")}`;
}

export function assembleShortDramaH3(input: {
  overview: string;
  references: Reference[];
  blocking: string;
  openingBlocking?: string;
  soundAndEditing: string;
  shots: DirectedShot[];
  aspectRatio?: string;
  artStyle?: string;
}) {
  const speakers = new Map<number, number>();
  const speakerShots = new Map<number, number[]>();
  input.shots.forEach((shot, index) => {
    for (const { subject } of shot.dialogue) {
      if (!speakers.has(subject)) speakers.set(subject, speakers.size + 1);
      const numbers = speakerShots.get(subject) ?? [];
      if (!numbers.includes(index + 1)) numbers.push(index + 1);
      speakerShots.set(subject, numbers);
    }
  });

  const references = input.references.map(({ name, role, resourceKey }, i) => ({ index: i + 1, name, role, ...(resourceKey && { resourceKey }) }));
  const subjectLines = input.references.map(({ description }, i) =>
    `<Subject ${i + 1}>: <Picture ${i + 1}>[${description}]`);

  const speakerLines = Array.from(speakers, ([subject, speaker]) =>
    `<Subject ${subject}> (S${speaker}) speaks only in ${speakerShots.get(subject)!.map(n => `[Shot ${n}]`).join(", ")}.`);
  const silent = input.shots.flatMap((shot, i) => shot.dialogue.length ? [] : [i + 1]);
  const timeRange = shotTimeline(input.shots);
  const durationSec = timeRange.at(-1)!.end;

  const shots = input.shots.map((shot, i) => [
    [
      `[Shot ${i + 1}] ${timecode(timeRange[i].start)}–${timecode(timeRange[i].end)}.`,
      shot.cameraAngle ? `Camera angle: ${shot.cameraAngle}.` : "",
      shot.cameraSetup ? cameraSetupDirection(shot.cameraSetup) : "",
      shot.direction,
    ].filter(Boolean).join(" "),
    ...(i === 0 && input.openingBlocking !== undefined ? [clipOpeningContinuity(input.openingBlocking)] : []),
    ...(shot.portraitFraming ? [`Portrait framing: ${shot.portraitFraming}`] : []),
    ...(shot.propSubjects?.length ? [`Match the props shown in this shot to ${shot.propSubjects.map(subject => `<Subject ${subject}>`).join(", ")}.`] : []),
    ...shot.dialogue.flatMap(({ subject, text, language, delivery, actionDuringSpeech }) => [
      ...(actionDuringSpeech ? [`Action during the next line: ${actionDuringSpeech}`] : []),
      `<Subject ${subject}> (S${speakers.get(subject)}) says${delivery ? ` ${delivery}` : ""}: <d>[${language}] ${text}</d>`,
    ]),
  ].join("\n"));

  const cleanSoundAndEditing = input.soundAndEditing
    .replace(/[^.!?]*(?:flute|strings?|piano|violin|cello|harp|drum|percussion|trumpet|horn|guitar|melody|motif|musical?|non[- ]?diegetic|bgm|background music|score|soundtrack|orchestr\w*|instrument\w*)[^.!?]*[.!?]?/gi, '')
    .replace(/\s{2,}/g, ' ').trim();

  const prompt = [
    `${durationSec} seconds, ${input.aspectRatio ?? "vertical 9:16"}. ${input.artStyle ?? "Ultra-realistic live-action Thai television drama"}. ${input.overview}`,
    ["SUBJECT REFERENCES", ...subjectLines].join("\n\n"),
    `FIXED BLOCKING, CAMERA AXIS AND LIGHT\n${input.blocking}`,
    [
      "SPEAKER LOCK",
      ...speakerLines,
      silent.length ? `Shots ${silent.join(", ")} are silent. Keep lips closed.` : "",
      speakers.size ? "Speak only the tagged dialogue verbatim in the listed order and language. Keep all production directions unspoken. Play actions marked during a line simultaneously with that line, and let replies follow on a natural breath. Keep speakers visible as they move and speak. When turns share a shot, stay in the same take and follow the planned camera movement. Carry action and conversation across the planned cuts. Preserve distinct voices and natural lip sync. No narration or overlapping voices." : "",
    ].filter(Boolean).join("\n"),
    ...shots,
    `BACKGROUND ACTIVITY, SOUND AND EDITING\n${cleanSoundAndEditing}\nKeep background movement and sound below the main action. No non-diegetic music or BGM — retain only diegetic sound effects and environmental audio. No extra dialogue, captions, fade or cut to black. End at ${timecode(durationSec)}.`,
  ].join("\n\n");

  return { prompt, references };
}
