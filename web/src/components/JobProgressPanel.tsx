import type { Job } from '../lib/api'

interface Props {
  job: Job | null
  onDismiss?: () => void
}

export function JobProgressPanel({ job, onDismiss }: Props) {
  if (!job) return null
  const pct = Math.round((job.progress ?? 0) * 100)
  const color = job.status === 'failed' ? 'bg-red-500' : job.status === 'succeeded' ? 'bg-green-500' : 'bg-blue-500'

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white border rounded-lg shadow-lg p-4 z-50">
      <div className="flex justify-between items-start mb-2">
        <div className="font-medium text-sm">งาน {job.stage}</div>
        {(job.status === 'succeeded' || job.status === 'failed') && (
          <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
        )}
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 mb-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-gray-500">
        {job.status === 'running' && `กำลังทำงาน… ${pct}%`}
        {job.status === 'succeeded' && '✔ เสร็จแล้ว'}
        {job.status === 'failed' && `✖ ล้มเหลว: ${job.error ?? ''}`}
        {job.status === 'queued' && 'รอคิว…'}
      </div>
      {job.tokens && (
        <div className="text-xs text-gray-400 mt-1">tokens: {job.tokens.in + job.tokens.out}</div>
      )}
    </div>
  )
}
