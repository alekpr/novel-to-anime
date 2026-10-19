import mongoose from 'mongoose';

await mongoose.connect('mongodb://127.0.0.1:27017/novel_anime');

const Episode = mongoose.model('Episode', new mongoose.Schema({}, { strict: false }));
const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false }));
const Char = mongoose.model('Character', new mongoose.Schema({}, { strict: false }));

// ดู episodes ทั้งหมด
const eps = await Episode.find({}).lean();
console.log('=== Episodes ===');
for (const e of eps) {
  const { _id, number, title, projectId, status, paragraphs } = e as any;
  console.log({ _id, number, title, projectId, status, paragraphCount: paragraphs?.length });
}

// ดู jobs ทั้งหมด (5 ล่าสุด)
const jobs = await Job.find({}).sort({ createdAt: -1 }).limit(5).lean();
console.log('\n=== Recent Jobs ===');
for (const j of jobs) {
  const { _id, stage, status, progress, error, episodeId, createdAt } = j as any;
  console.log({ _id, stage, status, progress, error: error?.slice?.(0, 300), episodeId, createdAt });
}

// ดู characters ทั้งหมด
const chars = await Char.find({}).lean();
console.log('\n=== Characters ===');
for (const c of chars) {
  const { name, episodes, status, projectId } = c as any;
  console.log({ name, episodes, status, projectId });
}

await mongoose.disconnect();
