export function clipOpeningContinuity(blocking?: string): string {
  const state = blocking?.trim();
  return [
    "Opening continuity: Match the previous clip's final physical blocking in the first frame.",
    state ? `Previous end state: ${state}` : "",
    "Keep the continuing characters at the same positions relative to the set and one another, with the same posture, eyelines and props in hand.",
    "Change the camera viewpoint on the same side of the action axis. Continue any movement already in progress from that instant. Start the next action or reply from there, without a new entrance, repeated approach or reset.",
  ].filter(Boolean).join(" ");
}
