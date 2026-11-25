export const DRAMA_CAMERA_ANGLES = ["frontal", "three-quarter", "side-profile", "rear", "high-angle", "low-angle", "overhead"] as const;
export type DramaCameraAngle = typeof DRAMA_CAMERA_ANGLES[number];

export const CAMERA_FRAMINGS = [
  "extreme wide shot", "wide shot", "full shot", "medium-wide shot", "medium shot",
  "medium close-up", "close-up", "reaction close-up", "extreme close-up", "insert close-up",
] as const;
export type CameraSetup = {
  focalLengthMm: number;
  framing: typeof CAMERA_FRAMINGS[number];
  subjectDistanceM?: number;
};

export const PORTRAIT_DIALOGUE_MAX_FRAME_HEIGHT_M = {
  "medium close-up": 0.85,
  "close-up": 0.55,
} as const;

export function estimatePortraitFrameHeightM(focalLengthMm: number, subjectDistanceM: number): number {
  // First-order field of view at the subject, using the 36 mm height of a rotated full-frame sensor.
  return 36 * subjectDistanceM / focalLengthMm;
}

export function cameraSetupLabel(setup: CameraSetup): string {
  return `${setup.focalLengthMm} mm ${setup.framing}`;
}

export function cameraSetupDirection(setup: CameraSetup): string {
  const lens = `Camera setup: ${cameraSetupLabel(setup)} (full-frame equivalent).`;
  return setup.subjectDistanceM === undefined ? lens : `${lens} Camera-to-subject distance: ${setup.subjectDistanceM} m.`;
}

export const PORTRAIT_LAYOUTS = ["single", "depth-two-shot", "over-the-shoulder", "environment", "detail"] as const;
export type PortraitFraming = {
  layout: typeof PORTRAIT_LAYOUTS[number];
  focusCharacterNames: string[];
  placement: string;
};

export function isPortraitRatio(ratio: string): boolean {
  const [width, height] = ratio.split(":").map(Number);
  return width > 0 && width < height;
}

export const DRAMA_CAMERA_LABELS: Record<DramaCameraAngle, string> = {
  frontal: "หน้าตรง",
  "three-quarter": "เฉียงสามส่วนสี่",
  "side-profile": "ด้านข้าง",
  rear: "ตรงจากด้านหลัง",
  "high-angle": "มุมสูง",
  "low-angle": "มุมต่ำ",
  overhead: "กดดิ่งจากด้านบน",
};

const similarAngles = [
  ["frontal", "three-quarter"],
  ["three-quarter", "side-profile"],
  ["high-angle", "overhead"],
];

export function distinctDramaAngles(a: DramaCameraAngle, b: DramaCameraAngle): boolean {
  return a !== b && !similarAngles.some(pair => pair.includes(a) && pair.includes(b));
}

export function cameraAngleFromDirection(camera = ""): DramaCameraAngle | undefined {
  if (/overhead|top[ -]down|bird.s.eye|มุมกดดิ่ง|มุมบนตรง/iu.test(camera)) return "overhead";
  if (/high[ -]angle|มุมสูง|กดลงชัด/iu.test(camera)) return "high-angle";
  if (/low[ -]angle|มุมต่ำ|เงยกล้อง/iu.test(camera)) return "low-angle";
  if (/three[ -]quarter|3\/4|สามส่วนสี่|เฉียงหน้า|เฉียงข้าง/iu.test(camera)) return "three-quarter";
  if (/side[ -]profile|\bprofile\b|ด้านข้าง|มุมข้าง/iu.test(camera)) return "side-profile";
  if (/\brear\b|จากด้านหลัง/iu.test(camera)) return "rear";
  if (/frontal|head[ -]on|straight[ -]on|หน้าตรง|ตรงหน้า/iu.test(camera)) return "frontal";
  return undefined;
}
