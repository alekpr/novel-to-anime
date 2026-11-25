export function characterImageKey(characterId: string) {
  return JSON.stringify(["character", characterId]);
}

export function outfitImageKeys(char: { _id: string; outfits?: readonly { name?: string }[] }) {
  const names = new Map<string, number>();
  return (char.outfits ?? []).map(outfit => {
    const name = (outfit.name ?? "").trim().normalize("NFC").toLowerCase();
    const occurrence = (names.get(name) ?? 0) + 1;
    names.set(name, occurrence);
    return JSON.stringify(["outfit", char._id, name, occurrence]);
  });
}

export function locationImageKey(locationId: string) {
  return JSON.stringify(["location", locationId]);
}

export function propImageKey(propId: string) {
  return JSON.stringify(["prop", propId]);
}
