import { Schema, model, Types } from "mongoose";

const paragraphSchema = new Schema({ idx: Number, text: String }, { _id: false });

const episodeSchema = new Schema({
  projectId: { type: Types.ObjectId, ref: "Project", required: true, index: true },
  number: { type: Number, required: true },
  title: { type: String, default: "" },
  status: {
    type: String,
    enum: ["ingested", "bible_review", "scenes_review", "shots_review", "done"],
    default: "ingested",
  },
  paragraphs: [paragraphSchema],
  summary: { type: String, default: "" },
  bibleVersion: { type: Number, default: 0 },
}, { timestamps: true });

episodeSchema.index({ projectId: 1, number: 1 }, { unique: true });

export const Episode = model("Episode", episodeSchema);
