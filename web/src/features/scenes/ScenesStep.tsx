import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AiLoadingBanner } from '../../components/AiLoadingBanner'
import { JobProgressPanel } from '../../components/JobProgressPanel'
import { SourceTextPane } from '../../components/SourceTextPane'
import { useJobStream } from '../../hooks/useJobStream'
import { episodesApi, scenesApi } from '../../lib/api'
import type { Scene } from '../../lib/api'

interface Props {
  episodeId: string
  onSelectScene: (sceneId: string) => void
  onDone: () => void
}

const moodColors: Record<string, string> = {
  tense: 'bg-red-100 text-red-700',
  romantic: 'bg-pink-100 text-pink-700',
  sad: 'bg-blue-100 text-blue-700',
  happy: 'bg-yellow-100 text-yellow-700',
  neutral: 'bg-gray-100 text-gray-600',
}

function SceneCard({ scene, onClick, selected }: { scene: Scene; onClick: () => void; selected?: boolean }) {
  return (
    <div
      onClick={onClick}
      className={`border rounded-lg p-4 bg-white cursor-pointer transition-colors space-y-2
        ${selected ? 'border-blue-500 ring-1 ring-blue-300' : 'hover:border-blue-400'}`}
    >
      <div className="flex justify-between items-start">
        <div>
          <span className="text-xs text-gray-400 font-mono">{scene.sceneCode}</span>
          <h3 className="font-medium">{scene.title}</h3>
        </div>
        <div className="flex gap-1 items-center">
          {scene.mood && (
            <span className={`text-xs px-2 py-0.5 rounded ${moodColors[scene.mood] ?? 'bg-gray-100 text-gray-600'}`}>
              {scene.mood}
            </span>
          )}
          <span className="text-xs text-gray-400">{scene.estDurationSec}s</span>
        </div>
      </div>
      <p className="text-sm text-gray-600 line-clamp-2">{scene.summary}</p>
      <div className="flex gap-2 text-xs text-gray-400">
        <span>👥 {scene.characterIds.length} ตัวละคร</span>
        {scene.shotCount && <span>🎬 {scene.shotCount} shots</span>}
      </div>
    </div>
  )
}

export function ScenesStep({ episodeId, onSelectScene, onDone }: Props) {
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null)
  const streamJob = useJobStream(jobId)

  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ['scenes', episodeId],
    queryFn: () => scenesApi.list(episodeId),
  })

  const runS2 = useMutation({
    mutationFn: () => episodesApi.runStage(episodeId, 'S2'),
    onSuccess: (job) => { jobIdRef.current = job._id; setJobId(job._id) },
  })

  useEffect(() => {
    if (streamJob?.status === 'succeeded' && jobIdRef.current) {
      qc.invalidateQueries({ queryKey: ['scenes', episodeId] })
      jobIdRef.current = null
      setJobId(null)
    }
  }, [streamJob?.status, episodeId, qc])

  const totalDur = scenes.reduce((s, sc) => s + sc.estDurationSec, 0)

  return (
    <div className="flex h-full min-h-0">
      {/* Scene list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-semibold">ขั้น 3 – Scenes</h2>
            {scenes.length > 0 && (
              <p className="text-sm text-gray-500">{scenes.length} ฉาก · รวม {totalDur}s</p>
            )}
          </div>
          <button
            onClick={() => runS2.mutate()}
            disabled={runS2.isPending || !!jobId}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
          >
            {jobId ? '⏳ กำลังแบ่งฉาก…' : '🤖 แบ่งฉากอัตโนมัติ'}
          </button>
        </div>

          <AiLoadingBanner job={streamJob} label="AI กำลังแบ่งฉาก" />

        {scenes.length === 0 && !jobId && (
          <div className="text-gray-500 text-sm bg-gray-50 rounded p-4">
            กดปุ่มเพื่อให้ AI แบ่งฉากจากนิยาย
          </div>
        )}

        {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}

        <div className="grid gap-3">
          {scenes.map(sc => (
            <SceneCard
              key={sc._id}
              scene={sc}
              onClick={() => setSelectedScene(sc)}
              selected={selectedScene?._id === sc._id}
            />
          ))}
        </div>

        {scenes.length > 0 && (
          <button onClick={onDone} className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700">
            ไปขั้น Shots ▶
          </button>
        )}

        <JobProgressPanel job={streamJob} onDismiss={() => setJobId(null)} />
      </div>

      {/* Source text pane */}
      {selectedScene && (
        <div className="w-80 border-l bg-gray-50 shrink-0">
          <div className="flex justify-between items-center px-4 py-2 border-b bg-white">
            <span className="text-xs font-medium text-gray-600">{selectedScene.sceneCode}</span>
            <div className="flex gap-2">
              <button
                onClick={() => onSelectScene(selectedScene._id)}
                className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                ดู Shots ▶
              </button>
              <button onClick={() => setSelectedScene(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
          </div>
          <SourceTextPane
            episodeId={episodeId}
            highlightRange={selectedScene.sourceRange}
          />
        </div>
      )}
    </div>
  )
}
