import { Schema, model, Types } from "mongoose";

const propObjectSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  name: { type: String, required: true },
  aliases: [String],
  category: {
    type: String,
    enum: ["weapon", "artifact", "clothing", "document", "container", "tool", "food", "vehicle", "other"],
    default: "other",
  },
  description: { type: String, default: "" },          // Thai
  visualPrompt: { type: String, default: "" },          // English — for image/video gen
  significance: { type: String, default: "" },          // บทบาทในเรื่อง (Thai)
  ownedBy: [{ type: Types.ObjectId, ref: "Character" }], // ตัวละครที่ครอบครอง
  episodes: [Number],
  status: { type: String, enum: ["draft", "approved"], default: "draft" },
}, { timestamps: true });

propObjectSchema.index({ projectId: 1, name: 1 }, { unique: true });

export const PropObject = model("PropObject", propObjectSchema);
