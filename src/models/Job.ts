import { Schema, model, Types } from "mongoose";

const jobSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true },
  episodeId: { type: Types.ObjectId, ref: "Episode" },
  stage: { type: String, enum: ["S0", "S1", "S2", "S3", "S4a", "S4b", "S5"], required: true },
  status: {
    type: String,
    enum: ["queued", "running", "interrupted", "succeeded", "failed"],
    default: "queued",
  },
  progress: { type: Number, default: 0 },
  error: { type: String, default: null },
  tokens: { in: { type: Number, default: 0 }, out: { type: Number, default: 0 } },
  finishedAt: { type: Date, default: null },
}, { timestamps: true });

jobSchema.index({ projectId: 1, status: 1 });

export const Job = model("Job", jobSchema);
