import { z } from "zod";
import { MAX_REFERENCE_IMAGES } from "./videoClipInputs.js";

export const WorkflowId = z.string().trim().regex(/^\d{1,30}$/, "กรุณาใส่เลข Workflow ของ RunningHub");

const Graph = z.record(z.string(), z.object({
  class_type: z.string(),
  inputs: z.record(z.string(), z.unknown()),
  _meta: z.object({ title: z.string().optional() }).passthrough().optional(),
}).passthrough());
type WorkflowGraph = z.infer<typeof Graph>;
type WorkflowInput = { prompt: string; ratio: string; duration: number; imagePaths: string[]; audioPaths?: string[] };
type Overrides = { nodeId: string; fieldName: string; fieldValue: unknown }[];
type WorkflowRequest = { nodeInfoList: Overrides } | { workflow: string };

export function parseWorkflow(raw: unknown) {
  const graph = Graph.parse(typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!Object.keys(graph).length) throw new Error("Empty workflow");
  return graph;
}

function workflowFields(graph: WorkflowGraph) {
  return Object.entries(graph).flatMap(([nodeId, node]) => Object.entries(node.inputs).flatMap(([fieldName, value]) => {
    if (typeof value !== "string" && typeof value !== "number" &&
        !(Array.isArray(value) && value.every(item => typeof item === "string"))) return [];
    return [{
      nodeId, fieldName, value: value as string | number | string[],
      name: fieldName.toLowerCase().replace(/[^a-z0-9]/g, ""),
      title: node._meta?.title || node.class_type, classType: node.class_type,
    }];
  }));
}

function only<T>(items: T[]): T | undefined {
  return items.length === 1 ? items[0] : undefined;
}

function namedInputs(graph: WorkflowGraph) {
  const fields = workflowFields(graph);
  const text = fields.filter(field => typeof field.value === "string");
  const prompt = only(text.filter(field => /^(prompt|positiveprompt|textprompt|videoprompt)$/.test(field.name))) ??
    only(text.filter(field => /^(text|value)$/.test(field.name) && /positive|prompt/i.test(field.title) && !/negative/i.test(field.title)));
  const ratio = only(text.filter(field => /^(aspectratio|ratio|videoaspectratio)$/.test(field.name))) ??
    only(text.filter(field => field.name === "value" && /aspect[ _-]?ratio/i.test(field.title)));
  const duration = only(fields.filter(field => !Array.isArray(field.value) &&
    /^(duration|durationsec|durationseconds|seconds|videoduration)$/.test(field.name))) ??
    only(fields.filter(field => !Array.isArray(field.value) && field.name === "value" && /duration.*(?:sec|second)|seconds/i.test(field.title)));
  const imageList = only(fields.filter(field => typeof field.value !== "number" &&
    /^(referenceimages|refimages|imagepaths|imagelist|imageurls|images)$/.test(field.name)));
  const numbered = text.flatMap(field => {
    const matched = field.name.match(/^(?:reference|ref)?(?:image|picture)([1-9])$/) ??
      (field.name === "image" ? field.title.match(/(?:reference|ref|image|picture|รูป|ภาพ)[ _#:-]*(?:image[ _#:-]*)?([1-9])\s*$/i) : null);
    return matched ? [{ ...field, position: Number(matched[1]) }] : [];
  }).sort((a, b) => a.position - b.position);
  const single = only(text.filter(field => field.name === "image" &&
    (/^loadimage$/i.test(field.classType) || field.nodeId === prompt?.nodeId)));
  const imageFields = numbered.length
    ? numbered.every((field, i) => field.position === i + 1) ? numbered : []
    : single ? [single] : [];

  const missing = [
    ...(!prompt ? ["พรอมป์"] : []), ...(!ratio ? ["สัดส่วน"] : []),
    ...(!duration ? ["ความยาว"] : []), ...(!imageList && !imageFields.length ? ["ภาพอ้างอิงตามลำดับ"] : []),
  ];
  if (missing.length || !prompt || !ratio || !duration) {
    throw new Error(`อ่านช่องรับค่า ${missing.join(", ")} จาก Workflow นี้ไม่ได้ กรุณาใช้ Workflow วิดีโอที่มีช่องเหล่านี้ชัดเจน`);
  }

  function set(field: typeof fields[number], fieldValue: unknown) {
    return { nodeId: field.nodeId, fieldName: field.fieldName, fieldValue };
  }

  return (input: WorkflowInput): WorkflowRequest => {
    if (input.audioPaths?.length) {
      throw new Error("Workflow นี้ไม่รองรับเสียงอ้างอิง กรุณาใช้ Workflow ที่มีโหนด MiniMax H3 Reference to Video");
    }
    if (!imageList && (imageFields.length < input.imagePaths.length ||
        imageFields.slice(input.imagePaths.length).some(field => field.value !== "" || field.classType === "LoadImage"))) {
      throw new Error(`Workflow มี ${imageFields.length} ช่องภาพที่ตรวจพบ แต่พรอมป์นี้ใช้ ${input.imagePaths.length} ภาพ กรุณาใช้ Workflow ที่รองรับจำนวนภาพนี้`);
    }
    const imageOverrides = imageList
      ? [set(imageList, Array.isArray(imageList.value) ? input.imagePaths : JSON.stringify(input.imagePaths))]
      : input.imagePaths.map((file, i) => set(imageFields[i], file));
    return { nodeInfoList: [
      set(prompt, input.prompt), set(ratio, input.ratio),
      set(duration, typeof duration.value === "number" ? input.duration : String(input.duration)),
      ...imageOverrides,
    ] };
  };
}

function nativeH3Inputs(graph: WorkflowGraph, targetId: string) {
  return (input: WorkflowInput): WorkflowRequest => {
    const workflow = structuredClone(graph);
    const target = workflow[targetId].inputs;
    const [x, y] = input.ratio.split(":").map(Number);
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    const divisor = gcd(x, y);
    const [widthUnit, heightUnit] = [x / divisor, y / divisor];
    const currentArea = typeof target.width === "number" && target.width > 0 &&
      typeof target.height === "number" && target.height > 0 ? target.width * target.height : 1344 * 768;
    // Native H3 requires a 32 px grid and aligns frame counts internally at 24 fps.
    const scale = Math.floor(Math.sqrt(currentArea / (widthUnit * heightUnit)) / 32) * 32;
    if (scale < 32) throw new Error("Workflow นี้สร้างสัดส่วนในพรอมป์ด้วยขนาดภาพที่ตั้งไว้ไม่ได้");

    for (const key of Object.keys(target)) {
      if (/^ref_(images|videos|video_audios|audios)(?:\.|$)/.test(key)) delete target[key];
    }
    Object.assign(target, { prompt: input.prompt, width: widthUnit * scale, height: heightUnit * scale, length: Math.round(input.duration * 24) });
    let nodeNumber = 1;
    input.imagePaths.forEach((file, i) => {
      while (Object.hasOwn(workflow, String(nodeNumber))) nodeNumber++;
      const id = String(nodeNumber++);
      workflow[id] = { class_type: "LoadImage", inputs: { image: file } };
      target[`ref_images.ref_image_${i}`] = [id, 0];
    });
    (input.audioPaths ?? []).forEach((file, i) => {
      while (Object.hasOwn(workflow, String(nodeNumber))) nodeNumber++;
      const id = String(nodeNumber++);
      workflow[id] = { class_type: "LoadAudio", inputs: { audio: file } };
      target[`ref_audios.ref_audio_${i}`] = [id, 0];
    });
    return { workflow: JSON.stringify(workflow) };
  };
}

export function planWorkflow(graph: WorkflowGraph) {
  const native = Object.entries(graph).filter(([, node]) => node.class_type === "MiniMaxH3ReferenceToVideo");
  if (native.length > 1) throw new Error("พบหลายโหนด MiniMax H3 ที่รับพรอมป์ใน Workflow เดียวกัน");
  const build = native.length ? nativeH3Inputs(graph, native[0][0]) : namedInputs(graph);
  return (input: WorkflowInput) => {
    if (!input.imagePaths.length || input.imagePaths.length > MAX_REFERENCE_IMAGES) throw new Error("จำนวนภาพอ้างอิงอยู่นอกช่วงที่รองรับ");
    return build(input);
  };
}
