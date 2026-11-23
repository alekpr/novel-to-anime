import { shotTimeline } from "../utils/shortDrama.js";

type Reference = {
  name: string;
  role: "character" | "location";
  description: string;
  resourceKey?: string;
};
type Dialogue = { subject: number; text: string; tone: string };
type DirectedShot = { durationSec: number; direction: string; dialogue: Dialogue[] };

function timecode(seconds: number) {
  return `00:${seconds.toFixed(3).padStart(6, "0")}`;
}

export function assembleShortDramaH3(input: {
  overview: string;
  references: Reference[];
  blocking: string;
  soundAndEditing: string;
  shots: DirectedShot[];
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
    `S${speaker} is ${input.references[subject - 1].name}, <Subject ${subject}>. Speaks only in Shot ${speakerShots.get(subject)!.join(", ")}.`);
  const silent = input.shots.flatMap((shot, i) => shot.dialogue.length ? [] : [i + 1]);
  const timeRange = shotTimeline(input.shots);
  const durationSec = timeRange.at(-1)!.end;

  const shots = input.shots.map((shot, i) => [
    `[Shot ${i + 1}] ${timecode(timeRange[i].start)}–${timecode(timeRange[i].end)}. ${shot.direction}`,
    ...shot.dialogue.flatMap(({ subject, text, tone }) => [
      `<Subject ${subject}> (S${speakers.get(subject)}): <d>[Thai] ${text}</d>`,
      `Vocal direction: ${tone}`,
    ]),
  ].join("\n"));

  const prompt = [
    `${durationSec} seconds, vertical 9:16. Ultra-realistic live-action Thai television drama. ${input.overview}`,
    ["SUBJECT REFERENCES", ...subjectLines].join("\n\n"),
    `FIXED BLOCKING, CAMERA AXIS AND LIGHT\n${input.blocking}`,
    [
      "SPEAKER LOCK",
      ...speakerLines,
      silent.length ? `Shots ${silent.join(", ")} are silent. Keep lips closed.` : "",
      speakers.size ? "Cut to each assigned speaker before the first word and stay on that face until the line ends. Preserve distinct voices and natural Thai lip sync. No overlapping voices." : "",
    ].filter(Boolean).join("\n"),
    ...shots,
    `BACKGROUND ACTIVITY, SOUND AND EDITING\n${input.soundAndEditing}\nKeep background movement and sound below the main action. No extra dialogue, captions, fade or cut to black. End at ${timecode(durationSec)}.`,
  ].join("\n\n");

  return { prompt, references };
}
