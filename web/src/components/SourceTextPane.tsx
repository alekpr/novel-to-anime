import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { episodesApi } from '../lib/api'

interface Props {
  episodeId: string
  highlightRange?: { fromParagraph: number; toParagraph: number }
}

export function SourceTextPane({ episodeId, highlightRange }: Props) {
  const { data: episode } = useQuery({
    queryKey: ['episode', episodeId],
    queryFn: () => episodesApi.get(episodeId),
  })
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightRange && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightRange])

  if (!episode) return <div className="p-4 text-gray-400 text-sm">กำลังโหลด…</div>

  return (
    <div className="h-full overflow-y-auto p-4 space-y-2 text-sm leading-relaxed">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
        ต้นฉบับ EP{episode.number}
      </div>
      {episode.paragraphs.map(p => {
        const inRange = highlightRange &&
          p.idx >= highlightRange.fromParagraph &&
          p.idx <= highlightRange.toParagraph
        return (
          <div
            key={p.idx}
            ref={inRange ? highlightRef : undefined}
            className={`rounded px-2 py-1 transition-colors ${inRange ? 'bg-yellow-100 border-l-2 border-yellow-400' : 'text-gray-600'}`}
          >
            <span className="text-xs text-gray-300 mr-2 select-none">{p.idx}</span>
            {p.text}
          </div>
        )
      })}
    </div>
  )
}
