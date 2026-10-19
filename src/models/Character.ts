import { Schema, model, Types } from "mongoose";

const relationshipSchema = new Schema({
  characterId: { type: Types.ObjectId, ref: "Character" },
  type: String,
  note: String,
}, { _id: false });

const appearanceSchema = new Schema({
  hair: String, skin: String, eyes: String, build: String, distinguishing: String,
  defaultOutfit: String,
  inferredFields: [String],
}, { _id: false });

const outfitSchema = new Schema({
  name: String, description: String,
  outfitPrompt: { type: String, default: "" },
  outfitSheetPrompt: { type: String, default: "" },
  usedInScenes: [String],
}, { _id: false });

const voiceSchema = new Schema({
  gender: String, ageRange: String, pitch: String, timbre: String,
  pace: String, accent: String, defaultEmotion: String,
  speechHabits: [String], sampleLines: [String], voicePrompt: String,
}, { _id: false });

const refImageSchema = new Schema({ url: String, approved: { type: Boolean, default: false } }, { _id: false });

const characterSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  name: { type: String, required: true },
  aliases: [String],
  role: { type: String, enum: ["main", "support", "extra"], default: "support" },
  age: String,
  personality: String,
  relationships: [relationshipSchema],
  firstAppearanceEp: Number,
  episodes: [Number],
  appearance: { type: appearanceSchema, default: () => ({}) },
  outfits: [outfitSchema],
  appearanceBlock: { type: String, default: "" },
  characterSheetPrompt: { type: String, default: "" },
  referenceImages: [refImageSchema],
  voice: { type: voiceSchema, default: () => ({}) },
  locationIds: [{ type: Types.ObjectId, ref: "Location" }],
  loraName: String,
  loraWeight: Number,
  status: { type: String, enum: ["draft", "approved"], default: "draft" },
  needsReview: { type: Boolean, default: false },
  version: { type: Number, default: 1 },
}, { timestamps: true });

characterSchema.index({ projectId: 1, name: 1 }, { unique: true });
characterSchema.index({ projectId: 1, aliases: 1 });

export const Character = model("Character", characterSchema);
