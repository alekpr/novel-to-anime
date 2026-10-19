import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

export type StepStatus = 'locked' | 'ready' | 'needs_review' | 'approved' | 'running' | 'stale' | 'failed'

export interface EpisodeStepInfo {
  key: string
  label: string
  status: StepStatus
}

export interface EpisodeStatusResult {
  steps: EpisodeStepInfo[]
  counts: {
    chars: number; charsApproved: number
    locs: number; locsApproved: number
    scenes: number; shots: number
    unreviewedDialogue: number; scenesWithClips: number
  }
}

export function useEpisodeStatus(episodeId: string | null) {
  return useQuery<EpisodeStatusResult>({
    queryKey: ['episode-status', episodeId],
    queryFn: () => api.get(`/episodes/${episodeId}/status`).then(r => r.data),
    enabled: !!episodeId,
    refetchInterval: 10_000,
  })
}
