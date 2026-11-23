import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import {
  DRAMA_EP_SECONDS, DRAMA_MAX_CLIP_SECONDS, DRAMA_MIN_CLIP_SECONDS, DRAMA_REPLAN_MESSAGE,
  hasInvalidDramaScenes, isDramaClipDuration, minimumDramaSceneCount,
} from '../../../../src/utils/shortDrama'
import { AiLoadingBanner } from '../../components/AiLoadingBanner'
import { JobProgressPanel } from '../../components/JobProgressPanel'
import { SourceTextPane } from '../../components/SourceTextPane'
import { useJobProgress } from '../../hooks/useJobProgress'
import { episodesApi, scenesApi } from '../../lib/api'
import type { Scene } from '../../lib/api'

const MOODS = ['neutral', 'tense', 'romantic', 'sad', 'happy', 'mysterious', 'comedic', 'epic']

function SceneEditModal({ scene, onClose }: { scene: Scene; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    title: scene.title,
    summary: scene.summary,
    mood: scene.mood,
    estDurationSec: scene.estDurationSec,
    timeOfDay: (scene as any).timeOfDay ?? '',
  })

  const update = useMutation({
    mutationFn: () => scenesApi.update(scene._id, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scenes', scene.episodeId] })
      onClose()
    },
  })

  const set = (k: string, v: string | number) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center">
          <h3 className="font-semibold text-lg">แก้ไข Scene <span className="text-gray-400 font-mono text-sm">{scene.sceneCode}</span></h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">ชื่อฉาก</label>
            <input
              className="w-full border rounded px-3 py-2 text-sm"
              value={form.title}
              onChange={e => set('title', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">สรุปฉาก</label>
            <textarea
              className="w-full border rounded px-3 py-2 text-sm resize-none"
              rows={4}
              value={form.summary}
              onChange={e => set('summary', e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-gray-500 mb-1 block">Mood</label>
              <select
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.mood}
                onChange={e => set('mood', e.target.value)}
              >
                {MOODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="w-32">
              <label className="text-xs text-gray-500 mb-1 block">ความยาว (วินาที)</label>
              <input
                type="number" min={5}
                className="w-full border rounded px-3 py-2 text-sm"
                value={form.estDurationSec}
                disabled={!!scene.dramaBeat}
                onChange={e => set('estDurationSec', Number(e.target.value))}
              />
            </div>
            <div className="w-28">
              <label className="text-xs text-gray-500 mb-1 block">เวลา</label>
              <input
                className="w-full border rounded px-3 py-2 text-sm"
                placeholder="day / night…"
                value={form.timeOfDay}
                onChange={e => set('timeOfDay', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded hover:bg-gray-50">ยกเลิก</button>
          <button
            onClick={() => update.mutate()}
            disabled={update.isPending}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
          >
            {update.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface Props {
  episodeId: string
  savedTargetDurationSec?: number | null
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

function SceneCard({ scene, onClick, selected, onEdit }: { scene: Scene; onClick: () => void; selected?: boolean; onEdit: () => void }) {
  const validDuration = isDramaClipDuration(scene.estDurationSec)
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
          <button
            onClick={e => { e.stopPropagation(); onEdit() }}
            className="text-xs px-2 py-0.5 rounded border border-gray-200 hover:bg-gray-100 text-gray-500"
          >✏️</button>
        </div>
      </div>
      <p className="text-sm text-gray-600 line-clamp-2">{scene.summary}</p>
      {scene.dramaBeat && (
        <div className="text-xs text-gray-500 space-y-1">
          <p>เปิดซีน · {scene.dramaBeat.entry}</p>
          <p>จบซีน · {scene.dramaBeat.exit}</p>
          {scene.dramaBeat.dialoguePurpose && <p>บทพูด · {scene.dramaBeat.dialoguePurpose}</p>}
          <p className={validDuration ? undefined : 'text-orange-700'}>
            {validDuration ? `1 คลิป · ${scene.estDurationSec} วินาที` : 'ต้องแบ่งซีนใหม่'}
          </p>
        </div>
      )}
      <div className="flex gap-2 text-xs text-gray-400">
        <span>👥 {scene.characterIds.length} ตัวละคร</span>
        {scene.shotCount && <span>🎬 {scene.shotCount} shots</span>}
      </div>
    </div>
  )
}

export function ScenesStep({ episodeId, savedTargetDurationSec, onSelectScene, onDone }: Props) {
  const qc = useQueryClient()
  const [jobId, setJobId] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const [selectedScene, setSelectedScene] = useState<Scene | null>(null)
  const [editingScene, setEditingScene] = useState<Scene | null>(null)
  const [targetDuration, setTargetDuration] = useState<{ minutes: string; seconds: string } | null>(null)
  const savedSeconds = Math.max(1, Math.round(savedTargetDurationSec ?? DRAMA_EP_SECONDS))
  const duration = targetDuration ?? {
    minutes: String(Math.floor(savedSeconds / 60)),
    seconds: String(savedSeconds % 60),
  }
  const minutes = Number(duration.minutes)
  const seconds = Number(duration.seconds)
  const targetDurationSec = minutes * 60 + seconds
  const validDuration = duration.minutes !== '' && duration.seconds !== '' &&
    Number.isSafeInteger(minutes) && minutes >= 0 &&
    Number.isInteger(seconds) && seconds >= 0 && seconds < 60 &&
    Number.isSafeInteger(targetDurationSec) && targetDurationSec >= DRAMA_MIN_CLIP_SECONDS
  const streamJob = useJobProgress(jobId)

  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ['scenes', episodeId],
    queryFn: () => scenesApi.list(episodeId),
  })

  const runS2 = useMutation({
    mutationFn: (targetDurationSec: number) => episodesApi.runStage(episodeId, 'S2', { targetDurationSec }),
    onSuccess: (id) => {
      jobIdRef.current = id
      setJobId(id)
      qc.invalidateQueries({ queryKey: ['episode', episodeId] })
    },
  })

  useEffect(() => {
    if (streamJob?.status === 'succeeded' && jobIdRef.current) {
      qc.invalidateQueries({ queryKey: ['scenes', episodeId] })
      qc.invalidateQueries({ queryKey: ['episode-status', episodeId] })
      jobIdRef.current = null
      setJobId(null)
    }
  }, [streamJob?.status, episodeId, qc])

  const totalDur = Math.round(scenes.reduce((sum, scene) => sum + scene.estDurationSec, 0))
  const isAnalyzing = runS2.isPending || streamJob?.status === 'queued' || streamJob?.status === 'running'
  const needsReplan = hasInvalidDramaScenes(scenes)

  return (
    <div className="flex h-full min-h-0">
      {/* Scene list */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h2 className="text-xl font-semibold">ขั้น 3 – Scenes</h2>
            <p className="text-sm text-gray-600">1 ซีน = 1 คลิป · ซีนละไม่เกิน {DRAMA_MAX_CLIP_SECONDS} วินาที</p>
            {validDuration && (
              <p className="text-sm text-gray-600">เวลาที่กรอกต้องใช้อย่างน้อย {minimumDramaSceneCount(targetDurationSec)} ซีน</p>
            )}
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={e => {
              e.preventDefault()
              if (validDuration && !isAnalyzing) runS2.mutate(targetDurationSec)
            }}
          >
            <fieldset className="flex items-center gap-2" disabled={isAnalyzing}>
              <legend className="mb-1 text-xs font-medium text-gray-600">เวลารวมเป้าหมาย</legend>
              <label className="flex items-center gap-1 text-sm text-gray-600">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  required
                  value={duration.minutes}
                  onChange={e => setTargetDuration({ ...duration, minutes: e.target.value })}
                  className="w-16 rounded border bg-white px-2 py-1.5 text-center text-gray-900"
                />
                นาที
              </label>
              <label className="flex items-center gap-1 text-sm text-gray-600">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={59}
                  step={1}
                  required
                  value={duration.seconds}
                  onChange={e => setTargetDuration({ ...duration, seconds: e.target.value })}
                  className="w-16 rounded border bg-white px-2 py-1.5 text-center text-gray-900"
                />
                วินาที
              </label>
            </fieldset>
            <button
              type="submit"
              disabled={isAnalyzing || !validDuration}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
            >
              {isAnalyzing ? '⏳ กำลังแบ่งฉาก…' : '🤖 แบ่งฉากอัตโนมัติ'}
            </button>
          </form>
        </div>

        {!validDuration && (
          <p role="status" className="text-sm text-red-700">กรอกนาทีเป็นจำนวนเต็มและวินาที 0–59 โดยเวลารวมต้องอย่างน้อย {DRAMA_MIN_CLIP_SECONDS} วินาที</p>
        )}
        <AiLoadingBanner job={streamJob} pending={runS2.isPending} label="AI กำลังแบ่งฉาก" />
        {runS2.isError && <p role="alert" className="text-sm text-red-700">เริ่มงานไม่สำเร็จ กรุณาลองอีกครั้ง</p>}
        {needsReplan && (
          <p role="status" className="rounded border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
            {DRAMA_REPLAN_MESSAGE}
          </p>
        )}

        {scenes.length === 0 && !jobId && (
          <div className="text-gray-500 text-sm bg-gray-50 rounded p-4">
            กรอกเวลารวมของตอน แล้วกดแบ่งฉากอัตโนมัติ
          </div>
        )}

        {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}

        {scenes.length > 0 && (
          <p className="text-sm text-gray-600">
            <span className="font-medium">ผลการแบ่งซีนที่บันทึกไว้</span>
            {' · '}{scenes.length} ซีน · รวม {Math.floor(totalDur / 60)} นาที {totalDur % 60} วินาที
          </p>
        )}

        <div className="grid gap-3">
          {scenes.map(sc => (
            <SceneCard
              key={sc._id}
              scene={sc}
              onClick={() => setSelectedScene(sc)}
              selected={selectedScene?._id === sc._id}
              onEdit={() => setEditingScene(sc)}
            />
          ))}
        </div>

        {scenes.length > 0 && !needsReplan && (
          <button onClick={onDone} className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700">
            ไปขั้น Shots ▶
          </button>
        )}

        <JobProgressPanel job={streamJob} onDismiss={() => setJobId(null)} />
      </div>

      {editingScene && <SceneEditModal scene={editingScene} onClose={() => setEditingScene(null)} />}

      {/* Source text pane */}
      {selectedScene && (
        <div className="w-80 border-l bg-gray-50 shrink-0">
          <div className="flex justify-between items-center px-4 py-2 border-b bg-white">
            <span className="text-xs font-medium text-gray-600">{selectedScene.sceneCode}</span>
            <div className="flex gap-2">
              <button
                onClick={() => onSelectScene(selectedScene._id)}
                disabled={needsReplan}
                className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
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
