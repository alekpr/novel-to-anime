import { Schema, model, Types } from "mongoose";

const generationTaskSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  episodeId: { type: Types.ObjectId, ref: "Episode" },
  target: {
    type: { type: String, enum: ["character", "location", "shot", "scene"] },
    id: Types.ObjectId,
  },
  workflowKey: { type: String, required: true },
  runninghubWorkflowId: String,
  runninghubTaskId: { type: String, default: null },
  generationKey: { type: String, index: true },
  params: { type: Schema.Types.Mixed, default: {} },
  nodeInfoList: { type: Schema.Types.Mixed, default: [] },
  status: {
    type: String,
    enum: ["pending", "queued", "running", "succeeded", "failed", "cancelled"],
    default: "pending",
  },
  attempts: { type: Number, default: 0 },
  error: { type: String, default: null },
  outputs: [{ url: String, type: String, assetId: Types.ObjectId }],
  cost: { credits: { type: Number, default: null } },
  startedAt: { type: Date, default: null },
  finishedAt: { type: Date, default: null },
}, { timestamps: true });

generationTaskSchema.index({ projectId: 1, status: 1 });
generationTaskSchema.index({ runninghubTaskId: 1 }, { sparse: true });

export const GenerationTask = model("GenerationTask", generationTaskSchema);
