import { Types } from "mongoose";
import { findCharacterIndex, normalizeName } from "./thaiName.js";

export type BibleEntity = {
  _id: Types.ObjectId;
  name: string;
  aliases: string[];
  status: "draft" | "approved";
  version: number;
};

export type MergeDecision =
  | { action: "create" }
  | { action: "update"; targetId: Types.ObjectId; isApproved: boolean }
  | { action: "needs_review"; reason: string };

/**
 * ตัดสินใจว่าจะ create / update / flag needsReview
 * สำหรับ entity ที่ LLM ส่งมา เทียบกับ Bible ที่มีอยู่
 */
export function decideMerge(
  incomingName: string,
  incomingAliases: string[],
  existing: BibleEntity[]
): MergeDecision {
  // 1) จับคู่ตรงๆ ด้วยชื่อหลักหรือ alias
  const exactIdx = findCharacterIndex(incomingName, existing);
  if (exactIdx !== -1) {
    const e = existing[exactIdx];
    return { action: "update", targetId: e._id, isApproved: e.status === "approved" };
  }

  // 2) ตรวจว่า alias ใหม่ชนกับ entity อื่นไหม
  const normIncoming = normalizeName(incomingName);
  const aliasMatches: number[] = [];
  for (const alias of incomingAliases) {
    const idx = findCharacterIndex(alias, existing);
    if (idx !== -1 && !aliasMatches.includes(idx)) aliasMatches.push(idx);
  }

  // alias ชนกับหลาย entity → ไม่แน่ใจ
  if (aliasMatches.length > 1) {
    const names = aliasMatches.map((i) => existing[i].name).join(", ");
    return {
      action: "needs_review",
      reason: `"${incomingName}" อาจตรงกับหลายตัวละคร: ${names}`,
    };
  }

  // alias ชนกับ 1 entity → อาจเป็นคนเดียวกัน แต่ชื่อต่างกัน → flag
  if (aliasMatches.length === 1) {
    const e = existing[aliasMatches[0]];
    // ถ้าชื่อ normalize ตรงกัน → update ได้เลย
    if (normalizeName(e.name) === normIncoming) {
      return { action: "update", targetId: e._id, isApproved: e.status === "approved" };
    }
    return {
      action: "needs_review",
      reason: `"${incomingName}" อาจเป็นคนเดียวกับ "${e.name}" (alias ตรงกัน)`,
    };
  }

  // ไม่พบเลย → สร้างใหม่
  return { action: "create" };
}

/**
 * รวม aliases โดยไม่ซ้ำ (normalize แล้วเทียบ)
 */
export function mergeAliases(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing.map(normalizeName));
  const result = [...existing];
  for (const a of incoming) {
    if (!seen.has(normalizeName(a))) {
      seen.add(normalizeName(a));
      result.push(a);
    }
  }
  return result;
}

/**
 * Merge object fields: ไม่ทับ field ที่มีค่าอยู่แล้วถ้า isApproved = true
 * ถ้า isApproved = false → ทับทุก field ที่ incoming มีค่า
 */
export function mergeFields<T extends Record<string, unknown>>(
  existing: T,
  incoming: Partial<T>,
  isApproved: boolean,
  lockedFields: (keyof T)[] = []
): Partial<T> {
  if (isApproved) {
    // approved → ทับได้เฉพาะ field ที่ไม่ได้ lock
    const update: Partial<T> = {};
    for (const key of Object.keys(incoming) as (keyof T)[]) {
      if (!lockedFields.includes(key) && incoming[key] !== undefined && incoming[key] !== "") {
        // ไม่ทับถ้า existing มีค่าอยู่แล้ว
        if (!existing[key]) update[key] = incoming[key];
      }
    }
    return update;
  }
  // draft → ทับทุก field ที่ incoming มีค่า (ยกเว้น lockedFields)
  const update: Partial<T> = {};
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    if (!lockedFields.includes(key) && incoming[key] !== undefined && incoming[key] !== "") {
      update[key] = incoming[key];
    }
  }
  return update;
}
