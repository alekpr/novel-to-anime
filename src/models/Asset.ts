import { Schema, model, Types } from "mongoose";

const assetSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  type: { type: String, enum: ["image", "video", "audio"], required: true },
  purpose: {
    type: String,
    enum: ["character_sheet", "character_ref", "location_master", "keyframe", "clip", "voice_sample"],
    required: true,
  },
  ownerType: { type: String, enum: ["character", "location", "shot", "scene"] },
  ownerId: Types.ObjectId,
  sourceUrl: { type: String, default: "" },
  storageKey: { type: String, default: "" },
  generationId: { type: Types.ObjectId, ref: "GenerationTask", default: null },
  approved: { type: Boolean, default: false },
  isPrimary: { type: Boolean, default: false },
  checksum: String,
  sizeBytes: Number,
}, { timestamps: true });

assetSchema.index({ projectId: 1, ownerType: 1, ownerId: 1 });

export const Asset = model("Asset", assetSchema);
