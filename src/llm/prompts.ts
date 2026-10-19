import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "prompts");

const cache = new Map<string, string>();

export function loadPrompt(filename: string): string {
  if (cache.has(filename)) return cache.get(filename)!;
  const content = fs.readFileSync(path.join(PROMPTS_DIR, filename), "utf-8");
  cache.set(filename, content);
  return content;
}
