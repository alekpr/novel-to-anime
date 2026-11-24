const bibleWordSegmenter = new Intl.Segmenter("th", { granularity: "word" });

type BibleEntry = {
  _id: unknown;
  name?: unknown;
  episodes?: readonly unknown[];
  firstAppearanceEp?: unknown;
};

export function episodeBibleSelector(episode: {
  number: number;
  status: string;
  paragraphs: readonly { text?: string | null }[];
}) {
  // Older analyses sometimes omitted returning cast from the episode links.
  const text = episode.status === "ingested" ? "" :
    episode.paragraphs.map(paragraph => paragraph.text).join("\n").normalize("NFC").toLowerCase();
  const boundaries = new Set(Array.from(bibleWordSegmenter.segment(text), part => part.index));
  boundaries.add(text.length);

  function hasFullName(name: string): boolean {
    const fullName = name.trim().normalize("NFC").toLowerCase();
    if (!fullName) return false;
    for (let index = text.indexOf(fullName); index >= 0; index = text.indexOf(fullName, index + 1)) {
      if (boundaries.has(index) && boundaries.has(index + fullName.length)) return true;
    }
    return false;
  }

  return <T extends BibleEntry>(entries: readonly T[], referencedIds: ReadonlySet<string>) =>
    entries.filter(entry =>
      entry.episodes?.includes(episode.number) ||
      entry.firstAppearanceEp === episode.number ||
      referencedIds.has(String(entry._id)) ||
      (typeof entry.name === "string" && hasFullName(entry.name)),
    );
}
