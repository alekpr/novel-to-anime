import { videoDuration, videoRatio } from "./videoClipInputs.js";

const nonLatinText = /(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])[\p{L}\p{M}\p{N}]/u;
const dialogueTag = /<\/?d\b/i;

export function usesLatinVideoDirection(text: string) {
  return !nonLatinText.test(text) && !dialogueTag.test(text);
}

export function usesLatinVideoPrompt(prompt: string) {
  const direction = prompt.replace(/<d>(?:(?!<\/?d\b)[\s\S])*<\/d>/gi, "");
  return usesLatinVideoDirection(direction);
}

export function videoPromptStructure(prompt: string) {
  const tags = [...new Set(Array.from(prompt.matchAll(/<(Subject|Picture)\s+(\d+)>/gi), ([, label, index]) =>
    `${label.toLowerCase()} ${index}`))].sort();
  const bindings = Array.from(prompt.matchAll(/^<Subject\s+(\d+)>:\s*<Picture\s+(\d+)>/gmi), ([, subject, picture]) =>
    [subject, picture]);
  const shots = prompt.split(/(?=^\[Shot\s+\d+\](?:\s|$))/mi).map(shot => ({
    shotNum: shot.match(/^\[Shot\s+(\d+)\]/i)?.[1],
    lines: Array.from(shot.matchAll(/(?:<Subject\s+(\d+)>\s*\(S(\d+|\?)\)[^<>\r\n]*)?(<d>[\s\S]*?<\/d>)/gi),
      ([, subject, speaker, spoken]) => [subject, speaker, spoken]),
  }));
  const legacyDuration = prompt.match(/\bThe target is a (\d+(?:\.\d+)?)-second\b/i)?.[1];
  const duration = videoDuration(prompt) ?? (legacyDuration ? Number(legacyDuration) : undefined);
  return JSON.stringify({ tags, bindings, shots, ratio: videoRatio(prompt), duration });
}
