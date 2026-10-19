import type { Job } from '../lib/api'

interface Props {
  job: Job | null
  label?: string
}

export function AiLoadingBanner({ job, label = 'กำลังประมวลผล' }: Props) {
  if (!job || (job.status !== 'running' && job.status !== 'queued')) return null
  const pct = Math.round((job.progress ?? 0) * 100)

  return (
    <div className="flex items-center gap-4 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
      {/* spinner */}
      <svg className="animate-spin h-5 w-5 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
      </svg>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-blue-800">{label}…</div>
        <div className="w-full bg-blue-100 rounded-full h-1.5 mt-1.5">
          <div
            className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
            style={{ width: pct > 0 ? `${pct}%` : '30%', animation: pct === 0 ? 'pulse 1.5s ease-in-out infinite' : undefined }}
          />
        </div>
      </div>
      {pct > 0 && <span className="text-xs text-blue-600 shrink-0">{pct}%</span>}
    </div>
  )
}
