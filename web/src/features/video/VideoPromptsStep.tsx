import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { optimizeApi, scenesApi } from '../../lib/api'
import type { OptimizeResult, Scene } from '../../lib/api'

interface Props { episodeId: string }

function CopyButton({ text, label = 'copy' }: { text: string; label?: string }) {
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

function Section({ title, content, mono = false, badge }: { title: string; content: string; mono?: boolean; badge?: string }) {
  const [open, setOpen] = useState(false)
  if (!content) return null
  return (
    <div className="border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-2.5 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{title}</span>
          {badge && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{badge}</span>}
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={content} />
          <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="border-t bg-gray-50 px-4 py-3">
          <pre className={`text-xs whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-[500px] ${mono ? 'font-mono' : 'font-sans'}`}>
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

function OptimizedPanel({ scene, maxClipSec }: { scene: Scene; maxClipSec: number | null }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)

  const { data: cached } = useQuery({
    queryKey: ['optimized', scene._id],
    queryFn: () => optimizeApi.getScene(scene._id),
    enabled: open,
    staleTime: 0,
  })

  const optimize = useMutation({
    mutationFn: () => optimizeApi.optimizeScene(scene._id, maxClipSec ?? undefined),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['optimized', scene._id] }),
  })

  const result: OptimizeResult | null = optimize.data ?? cached ?? null
  const hasClips = (scene as any).clips?.length > 0 || (scene as any).shotCount > 0

  return (
    <div className="border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-400">{(scene as any).sceneCode}</span>
          <span className="font-medium">{scene.title}</span>
          <span className="text-xs text-gray-400">{scene.estDurationSec}s</span>
          {result && <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">✔ optimized</span>}
          {!hasClips && <span className="text-xs bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">⚠ ยังไม่มี clips</span>}
        </div>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t bg-gray-50 px-4 pb-4 pt-3 space-y-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => optimize.mutate()}
              disabled={optimize.isPending || !hasClips}
              className="text-sm px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1.5"
            >
              {optimize.isPending && (
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              )}
              {optimize.isPending ? 'กำลัง optimize…' : result ? '↻ Optimize ใหม่' : '✨ Optimize H3 Prompt'}
            </button>
            {optimize.isError && (
              <span className="text-xs text-red-600">
                ✖ {String((optimize.error as any)?.response?.data?.error ?? optimize.error)}
              </span>
            )}
          </div>

          {result && (
            <div className="space-y-2">
              {/* Analysis */}
              <Section title="📋 Prompt Analysis Report" content={result.analysisReport} />
              <Section title="🗺 Subject & Picture Mapping" content={result.mappingTable} />
              <Section title="⏱ Dialogue Timing Calibration" content={result.timingReport} />

              {/* Optimized clips — each separately */}
              {result.optimizedClips.map((clip, i) => (
                <Section
                  key={i}
                  title={`🎬 Optimized H3 Prompt — Clip ${i + 1}/${result.optimizedClips.length}`}
                  content={clip}
                  mono
                  badge={`Clip ${i + 1}`}
                />
              ))}

              {/* ElevenLabs */}
              {result.elevenLabsScript && (
                <Section title="🎙 ElevenLabs Dialogue Script" content={result.elevenLabsScript} mono />
              )}

              {/* BGM */}
              <Section title="🎵 BGM Spec (แยกต่างหาก)" content={result.bgmSpec} />

              {/* Validation */}
              <Section title="✅ Validation Report" content={result.validationReport} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function VideoPromptsStep({ episodeId }: Props) {
  const [maxClipSec, setMaxClipSec] = useState<string>('')
  const qc = useQueryClient()

  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ['scenes', episodeId],
    queryFn: () => scenesApi.list(episodeId),
  })

  const optimizeAll = useMutation({
    mutationFn: async () => {
      const sec = maxClipSec ? Number(maxClipSec) : undefined
      for (const sc of scenes) {
        if ((sc as any).clips?.length > 0 || (sc as any).shotCount > 0) {
          await optimizeApi.optimizeScene(sc._id, sec)
          qc.invalidateQueries({ queryKey: ['optimized', sc._id] })
        }
      }
    },
  })

  const scenesWithClips = scenes.filter(sc => (sc as any).clips?.length > 0)

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-xl font-semibold">ขั้น 7 – H3 Prompt Optimizer</h2>
          <p className="text-sm text-gray-500 mt-1">
            วิเคราะห์และ optimize DY prompt จาก Step 6 ตาม MiniMax H3 Validation Rules
            — แยก BGM, สร้าง ElevenLabs script, ตรวจ dialogue timing
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 border rounded px-2 py-1.5 bg-white">
            <span className="text-xs text-gray-500">max clip:</span>
            <input
              type="number" min={1} max={60}
              placeholder="auto"
              value={maxClipSec}
              onChange={e => setMaxClipSec(e.target.value)}
              className="w-14 text-sm text-center outline-none"
            />
            <span className="text-xs text-gray-400">วิ</span>
          </div>
          <button
            onClick={() => optimizeAll.mutate()}
            disabled={optimizeAll.isPending || scenesWithClips.length === 0}
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 text-sm flex items-center gap-2"
          >
            {optimizeAll.isPending && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {optimizeAll.isPending ? 'กำลัง optimize…' : '✨ Optimize ทั้งหมด'}
          </button>
        </div>
      </div>

      {scenes.length > 0 && (
        <div className="text-xs text-gray-400">
          {scenesWithClips.length}/{scenes.length} scenes มี clips พร้อม optimize
        </div>
      )}

      {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}
      {!isLoading && scenes.length === 0 && (
        <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มี scenes — รัน Scene Breakdown ก่อน</div>
      )}

      <div className="space-y-3">
        {scenes.map(sc => (
          <OptimizedPanel
            key={sc._id}
            scene={sc}
            maxClipSec={maxClipSec ? Number(maxClipSec) : null}
          />
        ))}
      </div>
    </div>
  )
}
