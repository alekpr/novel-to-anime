import { Schema, model, Types } from "mongoose";

const workflowInputSchema = new Schema({
  var: String, nodeId: String, fieldName: String,
}, { _id: false });

const workflowSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", default: null },
  key: { type: String, required: true },
  kind: { type: String, enum: ["image", "video"], required: true },
  purpose: {
    type: String,
    enum: ["character_sheet", "location_master", "keyframe", "i2v", "t2v", "r2v", "i2v_flf", "r2v_draft"],
    required: true,
  },
  runninghubWorkflowId: { type: String, required: true },
  inputs: [workflowInputSchema],
  defaults: { type: Schema.Types.Mixed, default: {} },
  limits: {
    minSec: Number, maxSec: Number,
    maxRefImages: Number, maxRefVideos: Number, maxRefAudios: Number,
  },
  version: { type: Number, default: 1 },
  active: { type: Boolean, default: true },
}, { timestamps: true });

workflowSchema.index({ key: 1, active: 1 });

export const Workflow = model("Workflow", workflowSchema);
