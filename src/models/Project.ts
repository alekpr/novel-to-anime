import { Schema, model, Types } from "mongoose";

const styleGuideSchema = new Schema({
  artStyle: { type: String, default: "anime cel-shaded" },
  aspectRatio: { type: String, default: "16:9" },
  targetVideoModel: { type: String, default: "minimax-h3" },
  promptPrefix: { type: String, default: "DY" },
  negativePrompt: { type: String, default: "" },
}, { _id: false });

const videoModelSchema = new Schema({
  name: { type: String, default: "minimax-h3" },
  minDurationSec: { type: Number, default: 5 },
  maxDurationSec: { type: Number, default: 15 },
  fps: { type: Number, default: 24 },
  resolution: { type: String, default: "2K" },
  maxRefImages: { type: Number, default: 9 },
  maxRefVideos: { type: Number, default: 3 },
  maxRefAudios: { type: Number, default: 3 },
  promptMaxChars: { type: Number, default: null },
}, { _id: false });

const clipPolicySchema = new Schema({
  userMaxClipSec: { type: Number, default: 20 },
  targetClipSec: { type: Number, default: 12 },
  minClipSec: { type: Number, default: 5 },
  continuityMode: { type: String, enum: ["scene_keyframe", "last_frame"], default: "scene_keyframe" },
}, { _id: false });

const dialoguePolicySchema = new Schema({
  generateMissingDialogue: { type: Boolean, default: true },
  innerMonologue: { type: String, enum: ["narration", "expression", "insert-shot"], default: "narration" },
  dialogueLanguage: { type: String, enum: ["Thai", "English"], default: "Thai" },
}, { _id: false });

const projectSchema = new Schema({
  title: { type: String, required: true },
  language: { type: String, default: "th" },
  targetEpDurationSec: { type: Number, default: 480 }, // 8 นาที
  styleGuide: { type: styleGuideSchema, default: () => ({}) },
  videoModel: { type: videoModelSchema, default: () => ({}) },
  clipPolicy: { type: clipPolicySchema, default: () => ({}) },
  dialoguePolicy: { type: dialoguePolicySchema, default: () => ({}) },
}, { timestamps: true });

export const Project = model("Project", projectSchema);
