export type SubtitleScene = {
  sceneCode: string;
  clips?: readonly { clipCode: string; durationSec?: number; videoPrompt?: string; stale?: boolean }[];
};

export class SubtitleExportError extends Error {}

function promptTimeMs(time: string) {
  const [minutes, seconds] = time.split(":").map(Number);
  return minutes * 60_000 + Math.round(seconds * 1000);
}

function srtTime(ms: number) {
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000) % 60;
  const seconds = Math.floor(ms / 1000) % 60;
  return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":") +
    "," + String(ms % 1000).padStart(3, "0");
}

function clipSubtitles(prompt: string, durationMs: number, clipCode: string) {
  const invalidTiming = `อ่านเวลาบทพูดในพรอมป์ของ ${clipCode} ไม่ได้ กรุณาตรวจพรอมป์ในขั้น 6`;
  const shots: { start?: number; end?: number; lines: string[] }[] = [];
  // Read dialogue and shot headings together so a line of speech cannot be mistaken for a cut.
  const tokens = /<d>((?:(?!<\/?d\b)[\s\S])*)<\/d>|<\/?d\b|^[ \t]*\[Shot[ \t]+\d+\][ \t]*(?:(?:At[ \t]+)?(\d{2,}:[0-5]\d\.\d{3})(?:[ \t]*[–—-][ \t]*(\d{2,}:[0-5]\d\.\d{3}))?)?/gim;
  for (const [token, dialogue, start, end] of prompt.matchAll(tokens)) {
    if (dialogue !== undefined) {
      const shot = shots.at(-1);
      if (!shot) throw new SubtitleExportError(invalidTiming);
      const text = dialogue.replace(/^\s*\[[A-Za-z][A-Za-z -]*\][ \t]*/, "").trim();
      if (text) shot.lines.push(...text.split(/\r?\n/).filter(line => line.trim()));
    } else {
      if (token.startsWith("<")) throw new SubtitleExportError(`แท็กบทพูดในพรอมป์ของ ${clipCode} ไม่สมบูรณ์`);
      shots.push({
        start: start ? promptTimeMs(start) : shots.length === 0 ? 0 : undefined,
        end: end ? promptTimeMs(end) : undefined,
        lines: [],
      });
    }
  }

  let previousEnd = 0;
  return shots.flatMap((shot, i) => {
    const start = shot.start;
    const nextShot = shots[i + 1];
    const end = shot.end ?? (nextShot ? nextShot.start : durationMs);
    if (start === undefined || end === undefined || start < previousEnd || end <= start || end > durationMs) {
      throw new SubtitleExportError(invalidTiming);
    }
    previousEnd = end;
    return shot.lines.length ? [{ start, end, lines: shot.lines }] : [];
  });
}

export function buildEpisodeSubtitles(scenes: readonly SubtitleScene[]) {
  if (!scenes.length) throw new SubtitleExportError("ตอนนี้ยังไม่มีซีนสำหรับส่งออกซับไตเติล");
  const missing = scenes.filter(scene => !scene.clips?.length ||
    scene.clips.some(clip => clip.stale || !clip.videoPrompt?.trim()));
  if (missing.length) {
    throw new SubtitleExportError(`กรุณาสร้าง Video Prompt ล่าสุดในขั้น 6 สำหรับซีน ${missing.map(scene => scene.sceneCode).join(", ")} ก่อนส่งออกทั้งตอน`);
  }

  let offsetMs = 0;
  const blocks: string[] = [];
  for (const scene of scenes) {
    for (const clip of scene.clips ?? []) {
      const durationMs = Math.round((clip.durationSec ?? 0) * 1000);
      if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
        throw new SubtitleExportError(`คลิป ${clip.clipCode} ไม่มีความยาวที่ใช้ได้ กรุณาตรวจพรอมป์ในขั้น 6`);
      }
      for (const cue of clipSubtitles(clip.videoPrompt!, durationMs, clip.clipCode)) {
        blocks.push([
          String(blocks.length + 1),
          `${srtTime(offsetMs + cue.start)} --> ${srtTime(offsetMs + cue.end)}`,
          ...cue.lines,
        ].join("\r\n"));
      }
      offsetMs += durationMs;
    }
  }
  if (!blocks.length) throw new SubtitleExportError("Video Prompt ตอนนี้ไม่มีบทพูดให้ส่งออก");
  return { text: blocks.join("\r\n\r\n") + "\r\n", cueCount: blocks.length };
}
