interface Props {
  steps: { label: string; status: 'locked' | 'ready' | 'running' | 'needs_review' | 'approved' | 'stale' | 'failed' }[]
  current: number
  onSelect: (i: number) => void
}

const icons: Record<string, string> = {
  locked: '🔒', ready: '○', running: '⏳', needs_review: '●', approved: '✔', stale: '⚠', failed: '✖',
}
const colors: Record<string, string> = {
  locked: 'text-gray-400', ready: 'text-blue-500', running: 'text-blue-600',
  needs_review: 'text-orange-500', approved: 'text-green-600', stale: 'text-yellow-500', failed: 'text-red-500',
}

export function EpisodeStepper({ steps, current, onSelect }: Props) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2 px-4 bg-white border-b text-sm">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300 mx-1">─</span>}
          <button
            onClick={() => s.status !== 'locked' && onSelect(i)}
            disabled={s.status === 'locked'}
            className={`flex items-center gap-1 px-2 py-1 rounded whitespace-nowrap transition-colors
              ${i === current ? 'bg-blue-50 font-semibold' : 'hover:bg-gray-50'}
              ${colors[s.status]} ${s.status === 'locked' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
          >
            <span>{icons[s.status]}</span>
            <span>
              {i + 1}.{s.label}
            </span>
          </button>
        </div>
      ))}
    </div>
  )
}
