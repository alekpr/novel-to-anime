// คำนำหน้าชื่อไทยที่ควรตัดออกตอน normalize
const PREFIXES = ["คุณ", "พี่", "น้อง", "อา", "ลุง", "ป้า", "น้า", "ท่าน", "นาย", "นาง", "นางสาว", "ดร.", "ดร"];

export function normalizeName(name: string): string {
  let n = name.trim();
  for (const p of PREFIXES) {
    if (n.startsWith(p)) {
      n = n.slice(p.length).trim();
      break;
    }
  }
  return n.toLowerCase();
}

// คืน true ถ้า candidate ตรงกับ name หรือ aliases ใดๆ
export function matchesCharacter(
  candidate: string,
  name: string,
  aliases: string[]
): boolean {
  const norm = normalizeName(candidate);
  if (normalizeName(name) === norm) return true;
  return aliases.some((a) => normalizeName(a) === norm);
}

// หา index ของตัวละครที่ตรงกับ candidate ใน list
export function findCharacterIndex(
  candidate: string,
  list: Array<{ name: string; aliases: string[] }>
): number {
  return list.findIndex((c) => matchesCharacter(candidate, c.name, c.aliases));
}
