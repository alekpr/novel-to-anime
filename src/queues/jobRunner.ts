import PQueue from "p-queue";
import { config } from "../config/index.js";

type Queues = Record<string, PQueue>;

export const queues: Queues = {
  llm: new PQueue({ concurrency: 3 }),
  bible: new PQueue({ concurrency: 1 }),
  scenes: new PQueue({ concurrency: 1 }),
  shots: new PQueue({ concurrency: 3 }),
  prompts: new PQueue({ concurrency: 2 }),
  qa: new PQueue({ concurrency: 1 }),
  genImage: new PQueue({ concurrency: config.rh.maxConcurrentImage }),
  genVideo: new PQueue({ concurrency: config.rh.maxConcurrentVideo }),
};
