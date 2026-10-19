import { describe, it, expect } from "vitest";
import { Types } from "mongoose";
import { decideMerge, mergeAliases, mergeFields, type BibleEntity } from "../src/utils/mergeLogic.js";

function makeEntity(name: string, aliases: string[], status: "draft" | "approved" = "draft"): BibleEntity {
  return { _id: new Types.ObjectId(), name, aliases, status, version: 1 };
}

describe("decideMerge", () => {
  const existing = [
    makeEntity("ปลา", ["คุณปลา", "พี่ปลา"]),
    makeEntity("มิน", ["พี่มิน"], "approved"),
  ];

  it("ชื่อตรงกัน → update", () => {
    const r = decideMerge("ปลา", [], existing);
    expect(r.action).toBe("update");
    if (r.action === "update") expect(r.isApproved).toBe(false);
  });

  it("alias ตรงกัน → update", () => {
    const r = decideMerge("คุณปลา", [], existing);
    expect(r.action).toBe("update");
  });

  it("approved entity → update พร้อม isApproved = true", () => {
    const r = decideMerge("มิน", [], existing);
    expect(r.action).toBe("update");
    if (r.action === "update") expect(r.isApproved).toBe(true);
  });

  it("ชื่อใหม่ไม่ตรงใคร → create", () => {
    const r = decideMerge("โอ", [], existing);
    expect(r.action).toBe("create");
  });

  it("alias ชนกับหลาย entity → needs_review", () => {
    const ambiguous = [
      makeEntity("ปลา", ["น้องปลา"]),
      makeEntity("ปลาทอง", ["น้องปลา"]),
    ];
    const r = decideMerge("ปลาใหม่", ["น้องปลา"], ambiguous);
    expect(r.action).toBe("needs_review");
  });

  it("alias ชนกับ 1 entity แต่ชื่อต่างกัน → needs_review", () => {
    const r = decideMerge("ปลาน้อย", ["คุณปลา"], existing);
    expect(r.action).toBe("needs_review");
  });
});

describe("mergeAliases", () => {
  it("รวม aliases ไม่ซ้ำ (ชื่อต่างกันจริงๆ)", () => {
    const result = mergeAliases(["คุณปลา", "พี่ปลา"], ["พี่ปลา", "ปลาน้อย"]);
    expect(result).toEqual(["คุณปลา", "พี่ปลา", "ปลาน้อย"]);
  });

  it("normalize ก่อนเทียบ — น้องปลา/คุณปลา/พี่ปลา normalize เป็น ปลา เหมือนกัน → ไม่เพิ่มซ้ำ", () => {
    const result = mergeAliases(["คุณปลา", "พี่ปลา"], ["น้องปลา"]);
    // น้องปลา → ปลา ซึ่งซ้ำกับ คุณปลา/พี่ปลา → ไม่เพิ่ม
    expect(result).toEqual(["คุณปลา", "พี่ปลา"]);
  });

  it("ชื่อที่ normalize ต่างกันจริงๆ → เพิ่มได้", () => {
    const result = mergeAliases(["ปลา"], ["มิน"]);
    expect(result).toEqual(["ปลา", "มิน"]);
  });
});

describe("mergeFields", () => {
  const existing = { name: "ปลา", personality: "เงียบ", appearanceBlock: "short hair" };

  it("draft → ทับทุก field ที่ incoming มีค่า", () => {
    const update = mergeFields(existing, { personality: "ร่าเริง" }, false);
    expect(update.personality).toBe("ร่าเริง");
  });

  it("approved → ไม่ทับ field ที่มีค่าอยู่แล้ว", () => {
    const update = mergeFields(existing, { personality: "ร่าเริง", appearanceBlock: "long hair" }, true);
    expect(update.personality).toBeUndefined(); // มีค่าอยู่แล้ว
    expect(update.appearanceBlock).toBeUndefined(); // มีค่าอยู่แล้ว
  });

  it("approved → เพิ่ม field ที่ยังว่างอยู่", () => {
    const update = mergeFields({ ...existing, personality: "" }, { personality: "ร่าเริง" }, true);
    expect(update.personality).toBe("ร่าเริง");
  });

  it("lockedFields → ไม่ทับแม้ draft", () => {
    const update = mergeFields(existing, { appearanceBlock: "long hair" }, false, ["appearanceBlock"]);
    expect(update.appearanceBlock).toBeUndefined();
  });
});
