export function storySections(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const paragraphs = normalized.split(/\n[\t ]*\n+/).map(section => section.trim()).filter(Boolean);
  return paragraphs.length > 1 ? paragraphs : normalized.split("\n").map(line => line.trim()).filter(Boolean);
}

export function episodeParagraphs(text: string) {
  return storySections(text).map((paragraph, idx) => ({ idx, text: paragraph }));
}

export function storySectionsForEpisodes(text: string, count: number): string[] {
  const paragraphs = storySections(text);
  if (paragraphs.length >= count) return paragraphs;

  const sentenceSegmenter = new Intl.Segmenter("th", { granularity: "sentence" });
  const sentences = paragraphs.flatMap(paragraph => Array.from(
    sentenceSegmenter.segment(paragraph), sentence => sentence.segment.trim(),
  )).filter(Boolean);
  if (sentences.length >= count) return sentences;

  const wordSegmenter = new Intl.Segmenter("th", { granularity: "word" });
  const chunkLength = Math.max(1, Math.ceil(text.length / (count * 2)));
  return sentences.flatMap(sentence => {
    const chunks: string[] = [];
    let start = 0;
    for (const part of wordSegmenter.segment(sentence)) {
      if (!part.isWordLike || part.index - start < chunkLength) continue;
      chunks.push(sentence.slice(start, part.index).trim());
      start = part.index;
    }
    chunks.push(sentence.slice(start).trim());
    return chunks;
  }).filter(Boolean);
}
