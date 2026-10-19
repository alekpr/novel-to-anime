import { Schema, model, Types } from "mongoose";

const dialogueLineSchema = new Schema({
  speakerId: { type: Types.ObjectId, ref: "Character" },
  lineTh: String,
  tone: String,
  source: { type: String, enum: ["original", "generated"], default: "original" },
  reviewed: { type: Boolean, default: false },
}, { _id: false });

const promptsSchema = new Schema({
  video: { type: String, default: "" },
  image: { type: String, default: "" },
  voice: [{ speakerId: Types.ObjectId, text: String }],
}, { _id: false });

const qaSchema = new Schema({
  passed: { type: Boolean, default: false },
  issues: [String],
}, { _id: false });

const shotSchema = new Schema({
  sceneId: { type: Types.ObjectId, ref: "Scene", required: true },
  episodeId: { type: Types.ObjectId, ref: "Episode", required: true },
  order: { type: Number, required: true },
  shotCode: { type: String, required: true },
  shotType: {
    type: String,
    enum: ["wide", "medium", "close-up", "OTS", "insert", "POV"],
    default: "medium",
  },
  camera: String,
  durationSec: { type: Number, default: 4 },
  breakQuality: { type: String, enum: ["hard", "soft", "avoid"], default: "soft" },
  characterIds: [{ type: Types.ObjectId, ref: "Character" }],
  locationId: { type: Types.ObjectId, ref: "Location" },
  action: String,
  emotion: String,
  dialogue: [dialogueLineSchema],
  narration: { type: String, default: null },
  sfx: String,
  music: String,
  prompts: { type: promptsSchema, default: () => ({}) },
  keyframeAssetId: { type: Types.ObjectId, ref: "Asset", default: null },
  clipAssetId: { type: Types.ObjectId, ref: "Asset", default: null },
  takes: [{ type: Types.ObjectId, ref: "Asset" }],
  qa: { type: qaSchema, default: () => ({ passed: false, issues: [] }) },
}, { timestamps: true });

shotSchema.index({ sceneId: 1, order: 1 });
shotSchema.index({ episodeId: 1, shotCode: 1 }, { unique: true });

export const Shot = model("Shot", shotSchema);
