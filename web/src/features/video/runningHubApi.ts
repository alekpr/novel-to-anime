import { isAxiosError } from 'axios'
import api from '../../lib/api'
export type RunningHubSettings = {
  keySet: boolean
  workflowId: string
  connection: 'untested' | 'connected' | 'failed'
  connectionMessage?: string
}
export type VideoJob = {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  taskId?: string
  error?: string
  notice?: string
  videos: string[]
}

const clipUrl = (sceneId: string, clipCode: string) =>
  `/scenes/${sceneId}/clips/${encodeURIComponent(clipCode)}/runninghub`

export const runningHubSettingsKey = ['runninghub-settings']
export const runningHubCountsKey = (episodeId: string) => ['runninghub-counts', episodeId]

export const runningHubApi = {
  settings: () => api.get<RunningHubSettings>('/runninghub/settings').then(response => response.data),
  saveSettings: (input: { apiKey?: string; workflowId: string }) =>
    api.put<RunningHubSettings>('/runninghub/settings', input).then(response => response.data),
  test: () => api.post<RunningHubSettings>('/runninghub/test').then(response => response.data),
  getCounts: (episodeId: string) => api.get<{ counts: Record<string, number> }>(`/episodes/${episodeId}/runninghub/counts`).then(response => response.data.counts),
  getJob: (sceneId: string, clipCode: string) => api.get<{ job: VideoJob | null }>(clipUrl(sceneId, clipCode)).then(response => response.data),
  send: (sceneId: string, clipCode: string, body: FormData) =>
    api.post<{ job: VideoJob }>(clipUrl(sceneId, clipCode), body).then(response => response.data),
}

export function runningHubMessage(error: unknown, fallback: string) {
  return isAxiosError<{ error?: string }>(error) ? error.response?.data?.error || fallback
    : error instanceof Error ? error.message : fallback
}
