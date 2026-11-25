import axios from 'axios'
import type { CameraSetup, DramaCameraAngle, PortraitFraming } from '../../../src/utils/dramaCamera'
import type { VideoReferenceSlot } from '../../../src/utils/videoClipInputs'

const api = axios.create({ baseURL: '/api' })

api.interceptors.response.use(
  r => r,
  err => {
    const msg = err?.response?.data?.error
    if (msg) err.message = msg
    return Promise.reject(err)
  }
)

export interface Project {
  _id: string
  title: string
  language: string
  genre?: string
  createdAt: string
  deletionPending?: boolean
  storySource?: { mode: 'story' | 'outline'; episodeCount: number }
  styleGuide?: {
    artStyle?: string
    aspectRatio?: string
    promptPrefix?: string
    negativePrompt?: string
  }
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
  voice?: {
    gender?: string; pitch?: string; defaultEmotion?: string; speechHabits?: string[]; sampleLines?: string[]
    voicePrompt?: string; audioLines?: { tag: string; line: string }[]; audioReference?: string
    elevenLabsVoiceId?: string
  }
}

export interface PropObject {
  _id: string
  projectId: string
  name: string
  aliases: string[]
  category: 'weapon' | 'artifact' | 'clothing' | 'document' | 'container' | 'tool' | 'food' | 'vehicle' | 'other'
  description: string
  visualPrompt: string
  significance: string
  ownedBy: string[]
  episodes: number[]
  status: 'draft' | 'approved'
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
  cameraSetup?: CameraSetup
  portraitFraming?: PortraitFraming | null
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
  referenceSlots?: VideoReferenceSlot[]
  speakerCharacterIds?: string[]
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
  updateSettings: (id: string, styleGuide: NonNullable<Project['styleGuide']>) =>
    api.patch<Project>(`/projects/${id}`, { styleGuide }).then(r => r.data),
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
  regenerateVoicePrompt: (id: string) => api.post<Character>(`/characters/${id}/regenerate-voice-prompt`).then(r => r.data),
  fixUnknown: (id: string) => api.post<Character>(`/characters/${id}/fix-unknown`).then(r => r.data),
  uploadAudio: (id: string, file: File) => {
    const form = new FormData(); form.append('audio', file)
    return api.post<{ audioReference: string }>(`/characters/${id}/audio-reference`, form).then(r => r.data)
  },
  deleteAudio: (id: string) => api.delete(`/characters/${id}/audio-reference`).then(r => r.data),
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

// Props
export const propsApi = {
  list: (projectId: string) => api.get<PropObject[]>(`/projects/${projectId}/props`).then(r => r.data),
  update: (id: string, data: Partial<PropObject>) => api.patch<PropObject>(`/props/${id}`, data).then(r => r.data),
  approve: (id: string) => api.post<PropObject>(`/props/${id}/approve`).then(r => r.data),
  delete: (id: string) => api.delete(`/props/${id}`).then(r => r.data),
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

// Optimize (S7)
export interface OptimizeResult {
  analysisReport: string
  mappingTable: string
  timingReport: string
  optimizedClips: string[]
  elevenLabsScript: string
  bgmSpec: string
  validationReport: string
  raw: string
}

export const optimizeApi = {
  getScene: (sceneId: string) => api.get<OptimizeResult | null>(`/scenes/${sceneId}/optimized`).then(r => r.data),
  optimizeScene: (sceneId: string, maxClipSec?: number, imageRefFormat?: '@Image' | '<Picture>') =>
    api.post<OptimizeResult>(`/scenes/${sceneId}/optimize`, { maxClipSec, imageRefFormat }).then(r => r.data),
  getEpisode: (episodeId: string) =>
    api.get<Array<{ _id: string; sceneCode: string; title: string; hasOptimized: boolean; clipCount: number; optimizedClips: OptimizeResult | null }>>(`/episodes/${episodeId}/optimized`).then(r => r.data),
}

// BGM
export const bgmApi = {
  get: (sceneId: string) => api.get<{ bgmPrompt: string | null }>(`/scenes/${sceneId}/bgm`).then(r => r.data.bgmPrompt),
  generate: (sceneId: string) => api.post<{ bgmPrompt: string }>(`/scenes/${sceneId}/generate-bgm`).then(r => r.data.bgmPrompt),
}

export interface MusicCue {
  cueNumber: number
  title: string
  scenes: string[]
  startSec: number
  endSec: number
  durationSec: number
  emotionalArc: string
  instrumentation: string
  tempo: string
  dynamics: string
  rationale: string
  prompt: string
  audioUrl?: string
}
export interface EpisodeBgmAnalysis {
  overallArc: string
  cues: MusicCue[]
}
export const episodeBgmApi = {
  get: (episodeId: string) => api.get<{ analysis: EpisodeBgmAnalysis | null }>(`/episodes/${episodeId}/bgm-analysis`).then(r => r.data.analysis),
  analyze: (episodeId: string) => api.post<{ analysis: EpisodeBgmAnalysis }>(`/episodes/${episodeId}/analyze-bgm`).then(r => r.data.analysis),
  generateCue: (episodeId: string, cueNumber: number, prompt: string, durationSec: number) =>
    api.post<{ url: string; requestedDurationSec: number; actualDurationSec: number }>(
      `/episodes/${episodeId}/generate-lyria-cue`, { cueNumber, prompt, durationSec }
    ).then(r => r.data),
}

// Dialogue Script
export const dialogueApi = {
  get: (sceneId: string) => api.get<{ dialogueScript: string | null }>(`/scenes/${sceneId}/dialogue-script`).then(r => r.data.dialogueScript),
  generate: (sceneId: string) => api.post<{ dialogueScript: string }>(`/scenes/${sceneId}/generate-dialogue-script`).then(r => r.data.dialogueScript),
}

// ElevenLabs
export interface ElevenLabsVoice {
  voiceId: string
  name: string
  category?: string
  previewUrl?: string
  labels?: Record<string, string>
}
export interface ElevenLabsLine {
  shotNum: number
  startSec: number
  endSec: number
  speakerName: string
  speakerId: string
  voiceId: string
  text: string
  tone?: string
  availableTags: string[]
}
export interface ElevenLabsSpeaker {
  name: string
  voiceId: string | null
  availableTags: string[]
}
export const elevenLabsApi = {
  listVoices: () => api.get<{ voices: ElevenLabsVoice[] }>('/elevenlabs/voices').then(r => r.data.voices),
  setVoice: (charId: string, voiceId: string) =>
    api.post<Character>(`/characters/${charId}/set-elevenlabs-voice`, { voiceId }).then(r => r.data),
  getLines: (sceneId: string) =>
    api.get<{ lines: ElevenLabsLine[]; speakers: ElevenLabsSpeaker[] }>(`/scenes/${sceneId}/elevenlabs-lines`).then(r => r.data),
  generateAudio: (sceneId: string, opts?: { stability?: number; similarityBoost?: number; style?: number }) =>
    api.post<{ results: { speakerName: string; shotNum: number; text: string; filePath: string }[] }>(
      `/scenes/${sceneId}/generate-elevenlabs-audio`, opts ?? {}).then(r => r.data.results),
}

export default api
