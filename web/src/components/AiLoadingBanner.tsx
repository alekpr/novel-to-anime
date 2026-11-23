import type { Job } from '../lib/api'

interface Props {
  job: Job | null
  label?: string
  pending?: boolean
}

export function AiLoadingBanner({ job, label = 'กำลังประมวลผล', pending = false }: Props) {
  if (!pending && job?.status !== 'running' && job?.status !== 'queued') return null
  const pct = Math.round((job?.progress ?? 0) * 100)
  const isIndeterminate = pct === 0

  return (
    <div role="status" aria-live="polite" className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-4 space-y-3">
      <div className="flex items-center gap-3">
        {/* spinner */}
        <svg className="animate-spin h-5 w-5 text-blue-600 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-blue-800">{label}…</div>
          {job?.statusMessage && (
            <div className="text-xs text-blue-600 mt-0.5 truncate">{job.statusMessage}</div>
          )}
        </div>
        {!isIndeterminate && (
          <span className="text-sm font-semibold text-blue-700 shrink-0">{pct}%</span>
        )}
      </div>

      {/* progress bar */}
      <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
        {isIndeterminate ? (
          <div className="h-2 rounded-full bg-blue-400 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
        ) : (
          <div
            className="bg-blue-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>

      {/* step dots */}
      {!isIndeterminate && (
        <div className="flex items-center gap-2 pt-0.5">
          {[
            { threshold: 10, label: 'โหลดข้อมูล' },
            { threshold: 30, label: 'AI วิเคราะห์' },
            { threshold: 60, label: 'บันทึกข้อมูล' },
            { threshold: 100, label: 'เสร็จสิ้น' },
          ].map((step, i) => {
            const done = pct >= step.threshold
            const active = pct < step.threshold && (i === 0 || pct >= [10, 30, 60, 100][i - 1])
            return (
              <div key={i} className="flex items-center gap-1.5">
                {i > 0 && <div className={`h-px w-4 ${done ? 'bg-blue-400' : 'bg-blue-200'}`} />}
                <div className={`w-2 h-2 rounded-full shrink-0 ${done ? 'bg-blue-500' : active ? 'bg-blue-400 animate-pulse' : 'bg-blue-200'}`} />
                <span className={`text-xs ${done ? 'text-blue-600' : 'text-blue-300'}`}>{step.label}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
