import { useQuery } from '@tanstack/react-query'
import { jobsApi } from '../lib/api'
import type { Job } from '../lib/api'

export function useJobProgress(jobId: string | null): Job | null {
  const status = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => jobsApi.get(jobId!),
    enabled: !!jobId,
    refetchInterval: ({ state }) =>
      state.data?.status === 'succeeded' || state.data?.status === 'failed' || state.data?.status === 'interrupted' || state.status === 'error'
        ? false : 1000,
  })

  if (!jobId) return null
  return status.data ?? {
    _id: jobId, stage: '', projectId: '', createdAt: '', progress: 0,
    status: status.isError ? 'failed' : 'queued',
    error: status.isError ? 'โหลดสถานะงานไม่ได้' : undefined,
  }
}
