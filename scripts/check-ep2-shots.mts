import mongoose from 'mongoose';

await mongoose.connect('mongodb://127.0.0.1:27017/novel_anime');

const Scene = mongoose.model('Scene', new mongoose.Schema({}, { strict: false }));
const Shot = mongoose.model('Shot', new mongoose.Schema({}, { strict: false }));
const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false }));

const episodeId = '6ace49747e9c2b02713d22f5';

const scenes = await Scene.find({ episodeId }).sort({ order: 1 }).lean();
console.log(`=== Scenes (${scenes.length}) ===`);
for (const s of scenes) {
  const { _id, sceneCode, title, order, shotCount } = s as any;
  const shots = await Shot.find({ sceneId: _id }).lean();
  console.log({ _id, sceneCode, title, order, shotCount, actualShots: shots.length });
}

const jobs = await Job.find({ episodeId }).sort({ createdAt: -1 }).limit(5).lean();
console.log('\n=== Recent Jobs ===');
for (const j of jobs) {
  const { _id, stage, status, progress, error, createdAt } = j as any;
  console.log({ _id, stage, status, progress, error: error?.slice?.(0, 300), createdAt });
}

await mongoose.disconnect();
