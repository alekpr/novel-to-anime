import { z } from "zod";
import { config } from "../config/index.js";
import { RunningHubSettings } from "../models/RunningHubSettings.js";
import { parseWorkflow, type planWorkflow } from "../utils/runningHubWorkflow.js";

export class RunningHubError extends Error {
  constructor(readonly statusCode: number, message: string, readonly uncertain = false) {
    super(message);
  }
}

export async function readRunningHubSettings() {
  const doc = await RunningHubSettings.findById("global").select("+apiKey").lean();
  return {
    apiKey: doc?.apiKey || config.rh.apiKey,
    workflowId: doc?.workflowId ?? "",
    connection: doc?.connection ?? "untested",
    connectionMessage: doc?.connectionMessage,
    revision: doc?.revision,
  };
}

export function publicRunningHubSettings(settings: Awaited<ReturnType<typeof readRunningHubSettings>>) {
  return { keySet: !!settings.apiKey, workflowId: settings.workflowId,
    connection: settings.connection, connectionMessage: settings.connectionMessage };
}

const Envelope = z.object({ code: z.coerce.number(), msg: z.string().optional(), data: z.unknown() });

async function runningHubRequest(route: string, apiKey: string, input: Record<string, unknown> | FormData): Promise<unknown> {
  if (!apiKey) throw new RunningHubError(409, "กรุณาบันทึก RunningHub API Key ก่อน");
  const headers = new Headers({ Authorization: `Bearer ${apiKey}` });
  if (!(input instanceof FormData)) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(new URL(route, config.rh.baseUrl), {
      method: "POST",
      body: input instanceof FormData ? input : JSON.stringify({ ...input, apiKey }),
      headers, redirect: "error", signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new RunningHubError(502, "ติดต่อ RunningHub ไม่สำเร็จ", true);
  }
  if (response.status === 401 || response.status === 403) throw new RunningHubError(502, "RunningHub ปฏิเสธสิทธิ์ กรุณาตรวจ API Key และสิทธิ์ Workflow");
  const envelope = Envelope.safeParse(await response.json().catch(() => null));
  if (!response.ok || !envelope.success) throw new RunningHubError(502, `RunningHub ตอบกลับผิดรูปแบบ (HTTP ${response.status})`, response.ok || response.status >= 500);
  if (envelope.data.code !== 0) {
    const message = envelope.data.msg?.split(apiKey).join("[API Key]").replace(/[\r\n]+/g, " ").slice(0, 200);
    const code = envelope.data.code;
    const friendly = code === 301 || message?.toLowerCase().includes("user not exist")
      ? "API Key ไม่ถูกต้องหรือหมดอายุ กรุณาตรวจและอัปเดต API Key ใน Setup RunningHub"
      : code === 302 ? "Workflow ID ไม่ถูกต้อง กรุณาตรวจเลข Workflow ใน Setup RunningHub"
      : `RunningHub แจ้งข้อผิดพลาด ${code}${message ? ` · ${message}` : ""}`;
    throw new RunningHubError(502, friendly);
  }
  return envelope.data.data;
}

export async function getRunningHubWorkflow(apiKey: string, workflowId: string) {
  const data = await runningHubRequest("/api/openapi/getJsonApiFormat", apiKey, { workflowId });
  try {
    return parseWorkflow(z.object({ prompt: z.unknown() }).parse(data).prompt);
  } catch {
    throw new RunningHubError(422, "Workflow นี้ไม่มีช่องรับค่าที่ใช้ได้ กรุณาตรวจเลข Workflow และการตั้งค่าใน RunningHub");
  }
}

export async function uploadRunningHubImage(apiKey: string, file: File) {
  const form = new FormData();
  form.set("apiKey", apiKey);
  form.set("fileType", "input");
  form.set("file", file, file.name);
  const parsed = z.object({ fileName: z.string().min(1) }).safeParse(await runningHubRequest("/task/openapi/upload", apiKey, form));
  if (!parsed.success) throw new RunningHubError(502, "RunningHub ไม่ได้ส่งตำแหน่งภาพที่อัปโหลดกลับมา");
  return parsed.data.fileName;
}

export async function createRunningHubTask(apiKey: string, workflowId: string, request: ReturnType<ReturnType<typeof planWorkflow>>) {
  const data = await runningHubRequest("/task/openapi/create", apiKey, { ...request, workflowId });
  const parsed = z.object({ taskId: z.string().min(1), taskStatus: z.string().optional() }).safeParse(data);
  if (!parsed.success) throw new RunningHubError(502, "RunningHub ไม่ได้ส่งเลขงานกลับมา", true);
  return parsed.data;
}

export async function runningHubTaskResult(apiKey: string, taskId: string) {
  const data = await runningHubRequest("/task/openapi/status", apiKey, { taskId });
  const status = (typeof data === "string" ? data : z.object({ taskStatus: z.string() }).safeParse(data).data?.taskStatus)?.toUpperCase();
  if (status === "QUEUED" || status === "PENDING") return { status: "queued" as const };
  if (status === "RUNNING") return { status: "running" as const };
  if (status === "FAILED" || status === "CANCELLED" || status === "CANCELED") return { status: "failed" as const };
  if (status !== "SUCCESS" && status !== "SUCCEEDED") throw new RunningHubError(502, "RunningHub ยังไม่ส่งสถานะงานที่อ่านได้");
  const outputs = await runningHubRequest("/task/openapi/outputs", apiKey, { taskId });
  const results = z.array(z.object({ fileUrl: z.string(), fileType: z.string().optional() })).safeParse(outputs);
  if (!results.success) throw new RunningHubError(502, "RunningHub ยังไม่ส่งผลลัพธ์ที่อ่านได้");
  return { status: "succeeded" as const, outputs: results.data };
}
