export function characterReferenceSheet(character: string, appearance: string, outfit: string) {
  return [
    `Create one ultra-realistic live-action production character sheet of ${character}, vertical 2:3, in a clean 2×2 grid. Thin white dividers, taller bottom row, seamless medium-gray studio backdrop, soft neutral lighting and natural skin and fabric texture.`,
    appearance && `Face and identity: ${appearance}`,
    outfit && `Wardrobe: ${outfit}`,
    "TOP LEFT: exact frontal close-up of the face. TOP RIGHT: true 90-degree right-facing profile of the same face.",
    "BOTTOM LEFT: front wardrobe view. BOTTOM RIGHT: matching rear wardrobe view. Both start just below the chin and end at the floor, showing the clothing, accessories, hems and shoes without the head or face.",
    "Match identity, hairstyle, proportions, clothing details and scale across panels. Relaxed neutral stance. No labels, text, watermarks or logos.",
  ].filter(Boolean).join("\n\n");
}

export function locationReferenceSheet(name: string, description: string) {
  return [
    `Create one ultra-realistic live-action 2×2 production reference sheet of ${name}. ${description}`,
    "TOP LEFT: wide master, with entrances and key landmarks. TOP RIGHT: reverse view along the same axis. BOTTOM LEFT: side view showing distances and the relative positions of key objects. BOTTOM RIGHT: high-angle spatial overview tying the other three views together.",
    "Keep the same architecture, doors, furniture, props, material textures, time of day and light direction in all four views. Use thin neutral dividers. No labels, text or unrelated inserts.",
  ].join("\n\n");
}

export function propReferenceSheet(name: string, visualPrompt: string) {
  return [
    `Create one ultra-realistic live-action 2×2 production reference sheet of the prop "${name}". ${visualPrompt}`,
    "TOP LEFT: front view on a neutral studio surface. TOP RIGHT: rear or opposite-side view. BOTTOM LEFT: 45-degree three-quarter view showing depth and texture. BOTTOM RIGHT: close-up detail of the most distinctive feature, material or marking.",
    "Keep identical lighting, scale, color and material across all four panels. Thin neutral dividers. No labels, text, watermarks or unrelated objects.",
  ].join("\n\n");
}

export function audioReferencePrompt(characterName: string, voicePrompt: string) {
  return [
    `Generate a voice reference audio clip for the character "${characterName}". Maximum duration: 15 seconds.`,
    voicePrompt && `Voice characteristics: ${voicePrompt}`,
    "The clip should contain natural spoken dialogue that clearly demonstrates the character's voice tone, pitch, pace, accent and emotional register.",
    "Use a single clear sentence or short exchange. No background music or sound effects. Clean studio-quality recording.",
  ].filter(Boolean).join("\n\n");
}
