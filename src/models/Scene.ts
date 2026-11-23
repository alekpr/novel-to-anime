import { Schema, model, Types } from "mongoose";

const referencePictureSchema = new Schema({
  index: Number,
  role: { type: String, enum: ["scene_keyframe", "character_closeup", "extra"] },
  assetId: { type: Types.ObjectId, ref: "Asset" },
}, { _id: false });

const clipSchema = new Schema({
  clipCode: { type: String, required: true },
  shotIds: [{ type: Types.ObjectId, ref: "Shot" }],
  startOffsetSec: { type: Number, default: 0 },
  durationSec: Number,
  referencePictures: [referencePictureSchema],
  referenceSlots: [{ _id: false, index: Number, name: String, role: String, resourceKey: String }],
  videoPrompt: { type: String, default: "" },
  promptVersion: { type: Number, default: 1 },
  clipAssetId: { type: Types.ObjectId, ref: "Asset", default: null },
  takes: [{ type: Types.ObjectId, ref: "Asset" }],
  stale: { type: Boolean, default: false },
}, { _id: false });

const sceneSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  episodeId: { type: Types.ObjectId, ref: "Episode", required: true },
  order: { type: Number, required: true },
  sceneCode: { type: String, required: true },
  title: String,
  summary: String,
  locationId: { type: Types.ObjectId, ref: "Location" },
  timeOfDay: String,
  mood: String,
  characterIds: [{ type: Types.ObjectId, ref: "Character" }],
  sourceRange: { fromParagraph: Number, toParagraph: Number },
  estDurationSec: Number,
  dramaBeat: {
    type: new Schema({
      entry: String,
      exit: String,
      dialoguePurpose: String,
      clipDurationsSec: { type: [Number], default: undefined },
      supportingLocationIds: [{ type: Types.ObjectId, ref: "Location" }],
      wardrobe: [{ _id: false, characterId: { type: Types.ObjectId, ref: "Character" }, outfit: String }],
    }, { _id: false }),
    default: undefined,
  },
  shotsApproved: { type: Boolean, default: false },
  shotCount: { type: Number, default: 0 },
  totalDurationSec: { type: Number, default: 0 },
  videoPromptDraft: { type: Schema.Types.Mixed, default: null },
  clips: [clipSchema],
  status: { type: String, enum: ["draft", "approved"], default: "draft" },
}, { timestamps: true });

sceneSchema.index({ episodeId: 1, order: 1 });
sceneSchema.index({ episodeId: 1, sceneCode: 1 }, { unique: true });

export const Scene = model("Scene", sceneSchema);
