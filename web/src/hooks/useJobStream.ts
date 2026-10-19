import { useEffect, useRef, useState } from 'react'
import type { Job } from '../lib/api'

export function useJobStream(jobId: string | null) {
  const [job, setJob] = useState<Job | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!jobId) {
      setJob(null)
      return
    }
    // แสดง loading ทันทีก่อน SSE connect
    setJob({ _id: jobId, status: 'queued', progress: 0, stage: '', projectId: '', createdAt: '' })
    const es = new EventSource(`/api/jobs/${jobId}/stream`)
    esRef.current = es
    es.onmessage = (e) => {
      try { setJob(JSON.parse(e.data)) } catch {}
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [jobId])

  return job
}
