export const DRAMA_DIALOGUE_REQUIRED = "ตอนนี้ต้องมีช็อตที่มีบทพูดพร้อมผู้พูดและผ่านการอนุมัติอย่างน้อยหนึ่งช็อต";

export function isSpokenLine(text: unknown): text is string {
  return typeof text === "string" && /[\p{L}\p{N}]/u.test(text);
}

const spokenWords = new Intl.Segmenter("th", { granularity: "word" });
const scriptDirectionLabels = new Set([
  "สถานที่", "เวลา", "อารมณ์", "จบตอน",
  "location", "time", "time of day", "mood", "end of episode",
]);

export function dramaSpeechSeconds(lines: readonly { lineTh?: unknown }[]): number {
  return lines.reduce((seconds, { lineTh }) => {
    if (!isSpokenLine(lineTh)) return seconds;
    const words = [...spokenWords.segment(lineTh)].filter(word => word.isWordLike).length;
    const letters = lineTh.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
    // A planning estimate for natural delivery, with room to speak before the cut.
    return seconds + Math.max(words / 3.5, letters / 14) + 0.25;
  }, 0);
}

export function scriptedDramaDialogue(paragraphs: readonly { idx?: number | null; text?: string | null }[]) {
  return paragraphs.flatMap(({ idx, text }) => typeof idx === "number" && typeof text === "string"
    ? Array.from(text.matchAll(/^[ \t]*\*\*([^*:\r\n]+):\*\*[ \t]*(.+)$/gmu), ([, speaker, lineTh]) =>
      ({ idx, speaker: speaker.trim(), lineTh: lineTh.trim() }))
    : []).filter(({ speaker, lineTh }) => {
    const label = speaker.normalize("NFC").toLowerCase().replace(/\s+/gu, " ");
    return label.length > 0 && !scriptDirectionLabels.has(label) && isSpokenLine(lineTh);
  });
}

export function isImmediateScriptedReply(
  previous: { idx: number; speaker: string }, next: { idx: number; speaker: string },
) {
  return next.speaker !== previous.speaker && (next.idx === previous.idx || next.idx === previous.idx + 1);
}

export function matchScriptedDramaDialogue(
  expected: readonly { speaker: string; lineTh: string }[],
  actual: readonly { speaker: string; lineTh: string }[],
) {
  const words = (text: string) => text.normalize("NFC").replace(/\s+/gu, "");
  const matches: { start: number; end: number }[] = [];
  let index = 0;
  for (const turn of expected) {
    const text = words(turn.lineTh);
    let matched = false;
    while (index < actual.length && !matched) {
      let end = index;
      let combined = "";
      while (end < actual.length && actual[end].speaker === turn.speaker) {
        combined += words(actual[end++].lineTh);
        if (!text.startsWith(combined)) break;
        if (combined === text) {
          matched = true;
          matches.push({ start: index, end: end - 1 });
          index = end;
          break;
        }
      }
      if (!matched) index++;
    }
    if (!matched) return undefined;
  }
  return matches;
}

export function countDramaDialogue(shots: readonly {
  dialogue?: readonly unknown[];
  characterIds?: readonly unknown[];
}[], reviewedOnly = false): number {
  return shots.reduce((count, shot) => {
    const cast = new Set(shot.characterIds?.map(String));
    return count + (shot.dialogue ?? []).filter(line =>
      !!line && typeof line === "object" &&
      "lineTh" in line && isSpokenLine(line.lineTh) &&
      "speakerId" in line && line.speakerId != null && cast.has(String(line.speakerId)) &&
      (!reviewedOnly || ("reviewed" in line && line.reviewed === true))
    ).length;
  }, 0);
}
