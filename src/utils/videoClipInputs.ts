export const MAX_REFERENCE_IMAGES = 9;
export type VideoReferenceSlot = {
  index: number;
  name: string;
  role: "character" | "location" | "prop";
  resourceKey?: string;
};

export const MAX_REFERENCE_AUDIOS = 3;
export const MAX_REFERENCE_AUDIO_BYTES = 20_000_000;
export function supportedReferenceAudio(name: string, bytes: number) {
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(name) && bytes > 0 && bytes <= MAX_REFERENCE_AUDIO_BYTES;
}
export const MAX_REFERENCE_IMAGE_BYTES = 10_000_000;
export const videoRatio = (prompt: string) => prompt.split("\n", 1)[0].match(/\b([1-9]\d{0,2}:[1-9]\d{0,2})\b/)?.[1];
export const videoDuration = (prompt: string) => {
  const seconds = prompt.match(/^\s*(\d+(?:\.\d+)?)\s+(?:seconds?\b|วินาที)/i)?.[1];
  return seconds ? Number(seconds) : undefined;
};

export function validPictureSlots(prompt: string, slots: readonly { index: number }[]) {
  if (!slots.length || slots.length > MAX_REFERENCE_IMAGES || slots.some((slot, i) => slot.index !== i + 1)) return false;
  const tags = new Set(Array.from(prompt.matchAll(/<Picture\s+(\d+)>/gi), match => Number(match[1])));
  return tags.size === 0 || (tags.size === slots.length && slots.every(slot => tags.has(slot.index)));
}

export function supportedReferenceImage(name: string, bytes: number) {
  return /\.(png|jpe?g|webp)$/i.test(name) && bytes > 0 && bytes <= MAX_REFERENCE_IMAGE_BYTES;
}
