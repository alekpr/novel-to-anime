import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { promptsApi, scenesApi } from '../../lib/api'
import type { Scene } from '../../lib/api'

interface Props { episodeId: string }

interface Clip {
  clipCode: string
  durationSec: number
  startOffsetSec: number
  videoPrompt: string
  promptVersion: number
  stale?: boolean
}

function CopyButton({ text, label = 'copy prompt' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-xs px-2 py-1 border rounded hover:bg-gray-50 shrink-0"
    >
      {copied ? '✔ copied' : label}
    </button>
  )
}

function ClipCard({ clip, index }: { clip: Clip; index: number }) {
  const [open, setOpen] = useState(index === 0)
  return (
    <div className={`border rounded-lg overflow-hidden ${clip.stale ? 'border-yellow-400' : ''}`}>
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-medium">{clip.clipCode}</span>
          <span className="text-xs text-gray-500">{clip.durationSec}s</span>
          <span className="text-xs text-gray-400">@{clip.startOffsetSec}s</span>
          {clip.stale && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">⚠ stale</span>}
          {clip.videoPrompt && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">✔ มี prompt</span>}
        </div>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t bg-white px-4 pb-4 pt-3 space-y-2">
          {clip.videoPrompt ? (
            <>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">DY Prompt (v{clip.promptVersion})</span>
                <CopyButton text={clip.videoPrompt} />
              </div>
              <pre className="text-xs bg-gray-50 border rounded p-3 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-96">
                {clip.videoPrompt}
              </pre>
            </>
          ) : (
            <div className="text-sm text-gray-400">ยังไม่มี prompt — กด "สร้าง Prompt" ที่ scene นี้</div>
          )}
        </div>
      )}
    </div>
  )
}

function SceneClipsPanel({ scene, defaultOpen }: { scene: Scene; defaultOpen?: boolean }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(defaultOpen ?? false)

  const { data: sceneDetail, refetch } = useQuery({
    queryKey: ['scene-clips', scene._id],
    queryFn: () => promptsApi.getClips(scene._id),
    enabled: open,
    staleTime: 0,
  })

  const genPrompt = useMutation({
    mutationFn: () => promptsApi.generateScene(scene._id),
    onSuccess: () => refetch(),
  })

  const clips: Clip[] = sceneDetail?.clips ?? []
  const allPrompts = clips.map(c => c.videoPrompt).filter(Boolean).join('\n\n---\n\n')

  return (
    <div className="border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-400">{scene.sceneCode}</span>
          <span className="font-medium">{scene.title}</span>
          <span className="text-xs text-gray-400">{scene.estDurationSec}s</span>
          {clips.length > 0 && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{clips.length} clips</span>
          )}
        </div>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t bg-gray-50 px-4 pb-4 pt-3 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">
              {clips.length > 0
                ? `${clips.length} clips · รวม ${clips.reduce((s, c) => s + c.durationSec, 0)}s`
                : 'ยังไม่มี clips'}
            </span>
            <div className="flex gap-2">
              {clips.length > 0 && allPrompts && (
                <CopyButton text={allPrompts} label="copy ทั้งหมด" />
              )}
              <button
                onClick={() => genPrompt.mutate()}
                disabled={genPrompt.isPending}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {genPrompt.isPending && (
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                )}
                {genPrompt.isPending ? 'กำลังสร้าง…' : clips.length > 0 ? '↻ สร้างใหม่' : '🤖 สร้าง Prompt'}
              </button>
            </div>
          </div>
          {genPrompt.isError && (
            <div className="text-xs text-red-600 bg-red-50 rounded p-2">
              ✖ {String((genPrompt.error as any)?.response?.data?.message ?? genPrompt.error)}
            </div>
          )}
          {genPrompt.isSuccess && (
            <div className="text-xs text-green-700 bg-green-50 rounded p-2">
              ✔ สร้างแล้ว {clips.length} clips
            </div>
          )}
          {clips.map((clip, i) => <ClipCard key={clip.clipCode} clip={clip} index={i} />)}
        </div>
      )}
    </div>
  )
}

export function ClipsStep({ episodeId }: Props) {
  const qc = useQueryClient()
  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ['scenes', episodeId],
    queryFn: () => scenesApi.list(episodeId),
  })

  const [genAllResult, setGenAllResult] = useState<{ total: number; done: number } | null>(null)

  const genAll = useMutation({
    mutationFn: () => promptsApi.generateAll(episodeId),
    onMutate: () => setGenAllResult({ total: scenes.length, done: 0 }),
    onSuccess: (data) => {
      setGenAllResult({ total: data.total, done: data.total })
      scenes.forEach(sc => qc.invalidateQueries({ queryKey: ['scene-clips', sc._id] }))
    },
  })

  const scenesWithClips = scenes.filter(sc => (sc as any).clips?.length > 0).length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-xl font-semibold">ขั้น 6 – Video Prompts & Clips</h2>
          <p className="text-sm text-gray-500 mt-1">
            กด "สร้าง Prompt" ต่อ scene หรือ "สร้างทั้งหมด" แล้ว copy DY prompt ไปใช้
          </p>
        </div>
        <button
          onClick={() => genAll.mutate()}
          disabled={genAll.isPending || scenes.length === 0}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 text-sm shrink-0 flex items-center gap-2"
        >
          {genAll.isPending && (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {genAll.isPending ? 'กำลังสร้างทั้งหมด…' : '🤖 สร้างทั้งหมด'}
        </button>
      </div>

      {genAllResult && (
        <div className={`text-sm rounded p-3 ${genAllResult.done === genAllResult.total ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700'}`}>
          {genAllResult.done === genAllResult.total
            ? `✔ สร้างครบแล้ว ${genAllResult.total} scenes`
            : `⏳ กำลังสร้าง… (${genAllResult.done}/${genAllResult.total})`}
        </div>
      )}

      {scenes.length > 0 && (
        <div className="text-xs text-gray-400">
          {scenesWithClips}/{scenes.length} scenes มี prompt แล้ว
        </div>
      )}

      {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}
      {!isLoading && scenes.length === 0 && (
        <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มี scenes — รัน Scene Breakdown ก่อน</div>
      )}

      <div className="space-y-3">
        {scenes.map((sc, i) => <SceneClipsPanel key={sc._id} scene={sc} defaultOpen={i === 0} />)}
      </div>
    </div>
  )
}
