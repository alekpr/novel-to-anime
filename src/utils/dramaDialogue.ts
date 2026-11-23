export const DRAMA_DIALOGUE_REQUIRED = "ตอนนี้ต้องมีช็อตที่มีบทพูดพร้อมผู้พูดและผ่านการอนุมัติอย่างน้อยหนึ่งช็อต";

export function isSpokenLine(text: unknown): text is string {
  return typeof text === "string" && /[\p{L}\p{N}]/u.test(text);
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
