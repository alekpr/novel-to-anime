import { Schema, model, Types } from "mongoose";

const extraAngleSchema = new Schema({ name: String, prompt: String }, { _id: false });

const locationSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  name: { type: String, required: true },
  aliases: [String],
  type: { type: String, enum: ["interior", "exterior"], default: "interior" },
  description: String,
  timeOfDay: String,
  lighting: String,
  weather: String,
  materials: String,
  keyElements: [String],
  mood: String,
  locationBlock: { type: String, default: "" },
  masterPrompt: { type: String, default: "" },
  extraAngles: [extraAngleSchema],
  characterIds: [{ type: Types.ObjectId, ref: "Character" }],
  episodes: [Number],
  status: { type: String, enum: ["draft", "approved"], default: "draft" },
  version: { type: Number, default: 1 },
}, { timestamps: true });

locationSchema.index({ projectId: 1, name: 1 }, { unique: true });

export const Location = model("Location", locationSchema);
