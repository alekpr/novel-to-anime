import { Schema, model } from "mongoose";

const schema = new Schema({
  _id: String,
  apiKey: { type: String, select: false },
  workflowId: String,
  connection: { type: String, enum: ["untested", "connected", "failed"], default: "untested" },
  connectionMessage: String,
  revision: { type: Number, default: 0 },
}, { timestamps: true });

export const RunningHubSettings = model("RunningHubSettings", schema);
