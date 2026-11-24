import axios from 'axios'
import type { DramaCameraAngle } from '../../../src/utils/dramaCamera'

const api = axios.create({ baseURL: '/api' })

export interface Project {
  _id: string
  title: string
  language: string
  genre?: string
  createdAt: string
  deletionPending?: boolean
  storySource?: { mode: 'story' | 'outline'; episodeCount: number }
}

export type CreateProjectInput = {
  title: string
  language?: string
  genre?: string
  storySource?: NonNullable<Project['storySource']> & { text: string }
}

export interface Episode {
  _id: string
  projectId: string
  number: number
  title: string
  targetDurationSec?: number | null
  status: string
  productionStatus?: string
  paragraphs: { idx: number; text: string }[]
}

export interface Character {
  _id: string
  projectId: string
  name: string
  aliases: string[]
  role: 'main' | 'support' | 'extra' | 'monster'
  status: 'draft' | 'approved'
  needsReview?: boolean
  episodes: number[]
  appearance?: { hair?: string; skin?: string; eyes?: string; build?: string; defaultOutfit?: string; inferredFields?: string[] }
  appearanceBlock?: string
  referenceWardrobe?: string
  characterSheetPrompt?: string
  outfits?: { name: string; description: string; referenceAppearance?: string; outfitPrompt?: string; outfitSheetPrompt?: string; usedInScenes?: string[] }[]
  voice?: { gender?: string; pitch?: string; voicePrompt?: string }
}

export interface Faction {
  name: string
  description: string
  costumeDescription: string
  costumePrompt: string
}

export interface Location {
  _id: string
  projectId: string
  name: string
  type: 'interior' | 'exterior'
  description?: string
  locationBlock?: string
  masterPrompt?: string
  status: 'draft' | 'approved'
  episodes: number[]
}

export interface Scene {
  _id: string
  projectId: string
  episodeId: string
  order: number
  sceneCode: string
  title: string
  summary: string
  mood: string
  estDurationSec: number
  totalDurationSec?: number
  shotCount?: number
  shotsApproved?: boolean
  dramaBeat?: {
    entry: string; exit: string; dialoguePurpose?: string; dialogueBudgetSec?: number
    openingAngle?: DramaCameraAngle; closingAngle?: DramaCameraAngle; clipDurationsSec?: number[]
  }
  clips?: Clip[]
  status: 'draft' | 'approved'
  characterIds: string[]
  locationId?: string
  sourceRange?: { fromParagraph: number; toParagraph: number }
}

export interface Shot {
  _id: string
  sceneId: string
  order: number
  shotCode: string
  shotType: string
  camera: string
  cameraAngle?: DramaCameraAngle
  durationSec: number
  action: string
  characterIds?: (string | { _id: string; name: string })[]
  emotion?: string
  direction?: { blocking: string; performance: string; cut: string; backgroundActivity: string }
  dialogue: { speakerId?: string | { _id: string; name: string }; lineTh: string; tone?: string; source: 'original' | 'generated'; reviewed: boolean }[]
}

export interface Clip {
  clipCode: string
  durationSec: number
  startOffsetSec: number
  videoPrompt: string
  promptVersion: number
  promptRevision?: {
    comment: string
    updatedAt: string
    sourceJobId: string
    sourceVideoCount: number
    sourcePromptVersion?: number
  }
  stale?: boolean
  referenceSlots?: { index: number; name: string; role: 'character' | 'location'; resourceKey?: string }[]
}

export interface Job {
  _id: string
  projectId: string
  episodeId?: string
  stage: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'
  progress: number
  statusMessage?: string
  error?: string
  tokens?: { in: number; out: number }
  createdAt: string
  finishedAt?: string
}

// Projects
export const projectsApi = {
  list: () => api.get<Project[]>('/projects').then(r => r.data),
  create: (data: CreateProjectInput) => api.post<Project>('/projects', data).then(r => r.data),
  rename: (id: string, title: string) => api.patch<Project>(`/projects/${id}`, { title }).then(r => r.data),
  delete: (id: string) => api.delete<{ deleted: true }>(`/projects/${id}`, { data: { confirm: true } }).then(r => r.data),
}

// Episodes
export const episodesApi = {
  list: (projectId: string) => api.get<Episode[]>(`/projects/${projectId}/episodes`).then(r => r.data),
  create: (projectId: string, data: { number: number; title: string; text: string }) =>
    api.post<Episode>(`/projects/${projectId}/episodes`, data).then(r => r.data),
  get: (id: string) => api.get<Episode>(`/episodes/${id}`).then(r => r.data),
  runStage: (id: string, stage: string, opts?: { targetDurationSec?: number | null }) =>
    api.post<{ jobId: string }>(`/episodes/${id}/run/${stage}`, opts ?? {}).then(r => r.data.jobId),
}

// Characters
export const charactersApi = {
  list: (projectId: string) => api.get<Character[]>(`/projects/${projectId}/characters`).then(r => r.data),
  update: (id: string, data: Partial<Character>) => api.patch<Character>(`/characters/${id}`, data).then(r => r.data),
  approve: (id: string) => api.post<Character>(`/characters/${id}/approve`).then(r => r.data),
  delete: (id: string) => api.delete(`/characters/${id}`).then(r => r.data),
  generateOutfitPrompts: (id: string) => api.post<{ updated: number; character: Character }>(`/characters/${id}/generate-outfit-prompts`).then(r => r.data),
  regenerateAppearance: (id: string) => api.post<Character>(`/characters/${id}/regenerate-appearance`).then(r => r.data),
  resetAppearance: (id: string) => api.post<Character>(`/characters/${id}/reset-appearance`).then(r => r.data),
  fixUnknown: (id: string) => api.post<Character>(`/characters/${id}/fix-unknown`).then(r => r.data),
}

// Factions
export const factionsApi = {
  list: (projectId: string) => api.get<Faction[]>(`/projects/${projectId}/factions`).then(r => r.data),
  create: (projectId: string, data: Partial<Faction> & { name: string }) =>
    api.post<Faction[]>(`/projects/${projectId}/factions`, data).then(r => r.data),
  update: (projectId: string, name: string, data: Partial<Faction>) =>
    api.patch<Faction[]>(`/projects/${projectId}/factions/${encodeURIComponent(name)}`, data).then(r => r.data),
  delete: (projectId: string, name: string) =>
    api.delete<Faction[]>(`/projects/${projectId}/factions/${encodeURIComponent(name)}`).then(r => r.data),
}

// Locations
export const locationsApi = {
  list: (projectId: string) => api.get<Location[]>(`/projects/${projectId}/locations`).then(r => r.data),
  update: (id: string, data: Partial<Location>) => api.patch<Location>(`/locations/${id}`, data).then(r => r.data),
  approve: (id: string) => api.post<Location>(`/locations/${id}/approve`).then(r => r.data),
  regeneratePrompts: (id: string) => api.post<Location>(`/locations/${id}/regenerate-prompts`).then(r => r.data),
  resetPrompts: (id: string) => api.post<Location>(`/locations/${id}/reset-prompts`).then(r => r.data),
}

// Scenes
export const scenesApi = {
  list: (episodeId: string) => api.get<Scene[]>(`/episodes/${episodeId}/scenes`).then(r => r.data),
  update: (id: string, data: Partial<Scene>) => api.patch<Scene>(`/scenes/${id}`, data).then(r => r.data),
}

// Shots
export const shotApprovalKey = (episodeId: string) => ['approve-scene-shots', episodeId]

export const shotsApi = {
  list: (sceneId: string) => api.get<Shot[]>(`/scenes/${sceneId}/shots`).then(r => r.data),
  update: (id: string, data: Partial<Shot>) => api.patch<Shot>(`/shots/${id}`, data).then(r => r.data),
  updateDialogue: (id: string, idx: number, data: { reviewed?: boolean; lineTh?: string; tone?: string }) =>
    api.patch<Shot>(`/shots/${id}/dialogue/${idx}`, data).then(r => r.data),
  reviewAll: (id: string) => api.post<Shot>(`/shots/${id}/review-dialogue`).then(r => r.data),
  generateDialogue: (id: string) => api.post<Shot>(`/shots/${id}/generate-dialogue`).then(r => r.data),
  approveScene: (sceneId: string) => api.post<{
    shotCount: number
    promptStatus: 'updated' | 'unchanged' | 'failed'
    promptError?: string
  }>(`/scenes/${sceneId}/approve-shots`).then(r => r.data),
  generateForScene: (sceneId: string) => api.post(`/scenes/${sceneId}/generate-shots`).then(r => r.data),
}

// Jobs
export const jobsApi = {
  get: (id: string) => api.get<Job>(`/jobs/${id}`).then(r => r.data),
}

// Prompts / Clips
export const promptsApi = {
  generateScene: (sceneId: string) =>
    api.post(`/scenes/${sceneId}/generate-prompt`).then(r => r.data),
  generateAll: (episodeId: string) =>
    api.post<{ total: number; results: { sceneCode: string; clipCount: number; errors: string[] }[] }>(
      `/episodes/${episodeId}/generate-all-prompts`).then(r => r.data),
  getClips: (sceneId: string) =>
    api.get<{ clips: Clip[] }>(`/scenes/${sceneId}/clips`).then(r => r.data),
  reviseClip: (sceneId: string, clipCode: string, input: { comment: string; promptVersion: number; sourceJobId: string }) =>
    api.post<Pick<Clip, 'videoPrompt' | 'promptVersion' | 'promptRevision'>>(
      `/scenes/${sceneId}/clips/${encodeURIComponent(clipCode)}/revise-prompt`, input).then(r => r.data),
}

export default api
