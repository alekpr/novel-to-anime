import { describe, it, expect } from "vitest";
import { normalizeName, matchesCharacter, findCharacterIndex } from "../src/utils/thaiName.js";

describe("normalizeName", () => {
  it("ตัดคำนำหน้าออก", () => {
    expect(normalizeName("คุณปลา")).toBe("ปลา");
    expect(normalizeName("พี่มิน")).toBe("มิน");
    expect(normalizeName("น้องโอ")).toBe("โอ");
    expect(normalizeName("ดร.สมชาย")).toBe("สมชาย");
  });

  it("ชื่อที่ไม่มีคำนำหน้าคงเดิม", () => {
    expect(normalizeName("ปลา")).toBe("ปลา");
    expect(normalizeName("สมชาย")).toBe("สมชาย");
  });

  it("lowercase และ trim", () => {
    expect(normalizeName("  ปลา  ")).toBe("ปลา");
  });
});

describe("matchesCharacter", () => {
  const char = { name: "ปลา", aliases: ["คุณปลา", "พี่ปลา", "น้องปลา"] };

  it("ตรงกับชื่อหลัก", () => {
    expect(matchesCharacter("ปลา", char.name, char.aliases)).toBe(true);
  });

  it("ตรงกับ alias", () => {
    expect(matchesCharacter("คุณปลา", char.name, char.aliases)).toBe(true);
    expect(matchesCharacter("พี่ปลา", char.name, char.aliases)).toBe(true);
  });

  it("ไม่ตรงกับชื่ออื่น", () => {
    expect(matchesCharacter("มิน", char.name, char.aliases)).toBe(false);
  });
});

describe("findCharacterIndex", () => {
  const list = [
    { name: "ปลา", aliases: ["คุณปลา"] },
    { name: "มิน", aliases: ["พี่มิน", "มินมิน"] },
  ];

  it("หาตัวละครจากชื่อหลัก", () => {
    expect(findCharacterIndex("ปลา", list)).toBe(0);
    expect(findCharacterIndex("มิน", list)).toBe(1);
  });

  it("หาตัวละครจาก alias", () => {
    expect(findCharacterIndex("คุณปลา", list)).toBe(0);
    expect(findCharacterIndex("พี่มิน", list)).toBe(1);
    expect(findCharacterIndex("มินมิน", list)).toBe(1);
  });

  it("คืน -1 ถ้าไม่พบ", () => {
    expect(findCharacterIndex("โอ", list)).toBe(-1);
  });
});
