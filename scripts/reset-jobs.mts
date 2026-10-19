import mongoose from 'mongoose';

await mongoose.connect('mongodb://127.0.0.1:27017/novel_anime');

const Job = mongoose.model('Job', new mongoose.Schema({}, { strict: false }));

const result = await Job.updateMany(
  { episodeId: '6ace49747e9c2b02713d22f5', status: { $in: ['running', 'queued'] } },
  { $set: { status: 'failed', error: 'reset by admin', finishedAt: new Date() } }
);

console.log('Reset jobs:', result.modifiedCount);
await mongoose.disconnect();
