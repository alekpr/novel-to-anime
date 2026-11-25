import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { bgmApi, elevenLabsApi, episodeBgmApi, promptsApi, projectsApi, scenesApi, shotApprovalKey } from '../../lib/api'
import { useAppSettings } from '../../hooks/useAppSettings'
import { ReferenceSlots } from '../../components/ReferenceSlots'
import type { Clip, ElevenLabsLine, ElevenLabsSpeaker, MusicCue, Scene } from '../../lib/api'
import type { EpisodeImageResources } from '../images/useImageResources'
import { referenceUpdateKey } from '../images/updateReferencePrompt'
import { RunningHubConnection, RunningHubSetup } from './RunningHubSetup'
import { RunningHubClip } from './RunningHubClip'
import { buildSendFormData } from './clipReferences'
import { needsDramaVideoPromptRefresh } from '../../../../src/utils/shortDrama'
import { runningHubApi, runningHubCountsKey, runningHubSettingsKey } from './runningHubApi'
import type { RunningHubSettings } from './runningHubApi'
import { saveEpisodeSubtitles } from './footageStore'

interface Props {
  episodeId: string
  projectId: string
  resources: EpisodeImageResources
  visible: boolean
  onImages: () => void
}

// ---- Shared UI ----

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

function DownloadButton({ text, filename }: { text: string; filename: string }) {
  return (
    <button
      onClick={() => {
        const blob = new Blob([text], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = filename; a.click()
        URL.revokeObjectURL(url)
      }}
      className="text-xs px-2 py-1 border rounded hover:bg-gray-50 shrink-0"
      title={filename}
    >
      ↓ .md
    </button>
  )
}

// ---- Tab 1: DY Prompts Viewer ----

function SceneVideoPanel({ scene, projectId, resources, settings, generationCount, updatingFromShots, visible, onSetup, onImages, projectRatio }: {
  scene: Scene; projectId: string; resources: EpisodeImageResources; settings?: RunningHubSettings
  generationCount?: number; updatingFromShots: boolean; visible: boolean; projectRatio?: string
  onSetup: () => void; onImages: () => void
}) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const { data: sceneDetail } = useQuery({
    queryKey: ['scene-clips', scene._id],
    queryFn: () => promptsApi.getClips(scene._id),
    enabled: open,
  })

  const regen = useMutation({
    mutationFn: () => promptsApi.generateScene(scene._id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scene-clips', scene._id] }),
  })

  const savedClips: Clip[] = (open ? sceneDetail?.clips ?? scene.clips : scene.clips ?? sceneDetail?.clips) ?? []
  const clips = updatingFromShots ? [] : savedClips.filter(clip => !clip.stale)
  const hasPrompts = clips.some(c => c.videoPrompt)
  const allPrompts = clips.map(c => c.videoPrompt).filter(Boolean).join('\n\n---\n\n')
  const sceneCode = (scene as any).sceneCode ?? scene._id

  return (
    <div className="border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-gray-400">{sceneCode}</span>
          <span className="font-medium">{scene.title}</span>
          <span className="text-xs text-gray-400">{scene.estDurationSec}s</span>
          {hasPrompts && (
            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">✔ {clips.length} clips</span>
          )}
          {generationCount !== undefined && (
            <span className="whitespace-nowrap rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-800"
              title="จำนวนงานสร้างวิดีโอที่ RunningHub รับจากซีนนี้">
              Gen {generationCount} ครั้ง
            </span>
          )}
        </div>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      <div hidden={!open} className="border-t bg-gray-50 px-4 pb-4 pt-3 space-y-4">
        {updatingFromShots ? (
          <p role="status" className="text-sm text-blue-700">กำลังอัปเดต Video Prompt จากช็อตที่อนุมัติ…</p>
        ) : savedClips.some(clip => clip.stale && clip.videoPrompt) && (
          <p className="text-sm text-amber-800">ข้อมูลซีนหรือภาพอ้างอิงเปลี่ยนแล้ว กรุณาตรวจสถานะพรอมป์ของซีนนี้</p>
        )}
        {savedClips.length === 0 && !updatingFromShots && (
          <div className="flex items-center gap-3">
            <div className="text-sm text-gray-400">ยังไม่มี clips — ไปขั้น 6 เพื่อสร้าง prompt ก่อน</div>
          </div>
        )}
        {hasPrompts && !updatingFromShots && (
          <div className="flex justify-end">
            <button onClick={() => { if (confirm(`Regenerate video prompt ทั้งซีน ${sceneCode}?`)) regen.mutate() }}
              disabled={regen.isPending}
              className="text-xs px-2 py-1 border border-orange-300 text-orange-600 rounded hover:bg-orange-50 disabled:opacity-40 flex items-center gap-1">
              {regen.isPending ? 'กำลัง regenerate…' : '↺ Regenerate Prompt'}
            </button>
          </div>
        )}
        {regen.isError && <p className="text-xs text-red-600">{String(regen.error)}</p>}
        {clips.length > 1 && (
          <div className="flex justify-end gap-2">
            <DownloadButton text={allPrompts} filename={`${sceneCode}-ALL.md`} />
            <CopyButton text={allPrompts} label={`copy ทั้ง ${clips.length} clips`} />
          </div>
        )}
        {clips.map((clip, i) => (
          <div key={clip.clipCode} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-medium">{clip.clipCode}</span>
              <span className="text-xs text-gray-500">{clip.durationSec}s{scene.dramaBeat && ` · ${clip.startOffsetSec}–${clip.startOffsetSec + clip.durationSec}s ของตอน`}</span>
              <span className="text-xs text-gray-400">คลิป {i + 1}/{clips.length} ของซีน</span>
              {clip.promptRevision ? (
                <span className="ml-auto rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800">
                  อัปเดตจากคอมเมนต์ · v{clip.promptVersion}
                </span>
              ) : <span className="text-xs text-gray-400 ml-auto">v{clip.promptVersion ?? 1}</span>}
            </div>
            {clip.videoPrompt ? (
              <div className="space-y-2">
                <ReferenceSlots clip={clip} resources={resources} />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500">{scene.dramaBeat ? 'MiniMax H3 · 9:16' : 'DY Prompt'}</span>
                  <div className="flex gap-1">
                    <DownloadButton text={clip.videoPrompt} filename={`${clip.clipCode}.md`} />
                    <CopyButton text={clip.videoPrompt} />
                  </div>
                </div>
                <pre className="text-xs bg-white border rounded p-3 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-80">
                  {clip.videoPrompt}
                </pre>
                {clip.promptRevision && (
                  <p className="whitespace-pre-wrap break-words rounded bg-violet-50 px-3 py-2 text-xs text-violet-900">
                    <span className="font-semibold">คอมเมนต์ล่าสุด</span>{' '}{clip.promptRevision.comment}
                  </p>
                )}
                <RunningHubClip scene={scene} clip={clip} projectId={projectId} resources={resources}
                  settings={settings} visible={visible && open} onSetup={onSetup} onImages={onImages} projectRatio={projectRatio} />
              </div>
            ) : (
              <div className="text-xs text-gray-400 bg-white border rounded p-3">ยังไม่มี prompt</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Expandable prompt section ----

function Section({ title, content, mono = false, badge, filename }: {
  title: string; content: string; mono?: boolean; badge?: string; filename?: string
}) {
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
          {filename && <DownloadButton text={content} filename={filename} />}
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

// ---- Tab 3: BGM ----

function CueCard({ cue, episodeId, isGemini }: { cue: MusicCue; episodeId: string; isGemini: boolean }) {
  const [open, setOpen] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(cue.audioUrl ?? null)
  const [actualDur, setActualDur] = useState<number | null>(null)
  const qc = useQueryClient()
  const generate = useMutation({
    mutationFn: () => episodeBgmApi.generateCue(episodeId, cue.cueNumber, cue.prompt, cue.durationSec + 10),
    onSuccess: r => {
      setAudioUrl(r.url)
      setActualDur(r.actualDurationSec)
      qc.invalidateQueries({ queryKey: ['episode-bgm', episodeId] })
    },
  })
  return (
    <div className="rounded-lg border bg-white overflow-hidden">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded px-1.5 py-0.5">Cue {cue.cueNumber}</span>
            <span className="text-sm font-medium">{cue.title}</span>
            <span className="text-xs text-slate-400">{cue.durationSec.toFixed(1)}s</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {cue.scenes.map(sc => (
              <span key={sc} className="text-xs bg-slate-100 text-slate-600 rounded px-1.5 py-0.5">{sc}</span>
            ))}
          </div>
        </div>
        <span className="text-slate-400 text-xs shrink-0 mt-1">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t px-4 py-3 space-y-3 bg-slate-50">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-500">Emotional arc: </span><span>{cue.emotionalArc}</span></div>
            <div><span className="text-slate-500">Tempo: </span><span>{cue.tempo}</span></div>
            <div><span className="text-slate-500">Instrumentation: </span><span>{cue.instrumentation}</span></div>
            <div><span className="text-slate-500">Dynamics: </span><span>{cue.dynamics}</span></div>
          </div>
          <p className="text-xs text-slate-500 italic">{cue.rationale}</p>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600">Music Generation Prompt</span>
              <div className="flex items-center gap-1.5">
                <CopyButton text={cue.prompt} label="copy prompt" />
                <a
                  href={`https://aistudio.google.com/generate-music`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={() => navigator.clipboard.writeText(cue.prompt)}
                  className="text-xs px-2 py-1 border border-blue-300 text-blue-700 rounded hover:bg-blue-50"
                  title="คัดลอก prompt แล้วเปิด AI Studio (Lyria 3 Pro)"
                >
                  🎵 Open Lyria
                </a>
                <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending || !isGemini}
                  className="text-xs px-2 py-1 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-40"
                  title={!isGemini ? 'ต้องตั้ง LLM_PROVIDER=gemini' : undefined}>
                  {generate.isPending ? '⏳ generating…' : '🎵 Generate'}
                </button>
              </div>
            </div>
            <pre className="text-xs font-mono bg-white border rounded p-2 whitespace-pre-wrap leading-relaxed">{cue.prompt}</pre>
          </div>
          {generate.isError && <p className="text-xs text-red-600">{(generate.error as Error).message}</p>}
          {audioUrl && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-slate-600">Generated Audio</p>
                {actualDur && <span className="text-xs text-slate-400">{actualDur}s actual</span>}
              </div>
              <audio controls src={audioUrl} className="w-full h-8" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function EpisodeBgmPanel({ episodeId }: { episodeId: string }) {
  const qc = useQueryClient()
  const key = ['episode-bgm', episodeId]
  const query = useQuery({
    queryKey: key,
    queryFn: () => episodeBgmApi.get(episodeId),
    staleTime: Infinity,
  })
  const analyze = useMutation({
    mutationFn: () => episodeBgmApi.analyze(episodeId),
    onSuccess: data => qc.setQueryData(key, data),
  })
  const { data: settings } = useAppSettings()
  const isGemini = settings?.llmProvider === 'gemini'
  const analysis = query.data ?? null

  return (
    <div className="rounded-xl border-2 border-violet-200 bg-violet-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-violet-800">🎼 Episode BGM Analysis</p>
          <p className="text-xs text-violet-600 mt-0.5">วิเคราะห์ทุก scene รวมกัน — AI แนะนำว่าควรมีกี่ cue และ scene ไหนรวมกันได้</p>
        </div>
        <button type="button" onClick={() => analyze.mutate()} disabled={analyze.isPending}
          className="shrink-0 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40">
          {analyze.isPending ? 'กำลังวิเคราะห์…' : analysis ? '↻ Analyze ใหม่' : '✨ Analyze Episode BGM'}
        </button>
      </div>
      {analyze.isError && <p className="text-sm text-red-600">{(analyze.error as Error).message}</p>}
      {analysis && (
        <div className="space-y-3">
          <div className="rounded-lg bg-white border px-3 py-2">
            <p className="text-xs font-medium text-slate-500 mb-1">Overall Emotional Arc</p>
            <p className="text-sm text-slate-700">{analysis.overallArc}</p>
          </div>
          <p className="text-xs font-medium text-slate-500">{analysis.cues.length} Music Cues</p>
          {analysis.cues.map(cue => <CueCard key={cue.cueNumber} cue={cue} episodeId={episodeId} isGemini={isGemini} />)}
        </div>
      )}
    </div>
  )
}

function BgmPanel({ scene }: { scene: Scene }) {
  const qc = useQueryClient()
  const bgmKey = ['bgm', scene._id]
  const bgmQuery = useQuery({
    queryKey: bgmKey,
    queryFn: () => bgmApi.get(scene._id),
    staleTime: Infinity,
  })
  const generate = useMutation({
    mutationFn: () => bgmApi.generate(scene._id),
    onSuccess: data => qc.setQueryData(bgmKey, data),
  })
  const prompt = bgmQuery.data ?? null
  return (
    <div className="rounded-lg border bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div>
          <p className="text-sm font-medium">{scene.sceneCode} — {scene.title}</p>
          <p className="text-xs text-slate-500">{scene.totalDurationSec ? `${scene.totalDurationSec}s` : ''} · {scene.shotCount ?? 0} shots</p>
        </div>
        <button type="button" onClick={() => generate.mutate()} disabled={generate.isPending}
          className="shrink-0 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-40">
          {generate.isPending ? 'กำลัง generate…' : prompt ? '↻ Regenerate' : '✨ Generate BGM Prompt'}
        </button>
      </div>
      {generate.isError && <p role="alert" className="px-4 pb-3 text-sm text-red-700">{(generate.error as Error).message}</p>}
      {prompt && (
        <div className="border-t">
          <Section title="BGM & Sound Design Prompt" content={prompt} mono filename={`${scene.sceneCode}-BGM.md`} />
        </div>
      )}
    </div>
  )
}

// ---- Tab 4: Dialogue / ElevenLabs ----

function SpeakerBlock({ speaker, lines, sceneId }: {
  speaker: ElevenLabsSpeaker; lines: ElevenLabsLine[]; sceneId: string
}) {
  const qc = useQueryClient()
  const myLines = lines.filter(l => l.speakerName === speaker.name)

  // build ready-to-paste script
  const scriptText = myLines.map(l => {
    const tag = l.tone ?? l.availableTags[0] ?? 'calm'
    return `// Shot ${l.shotNum} (${l.startSec.toFixed(1)}s–${l.endSec.toFixed(1)}s)
[${tag}]${l.text}[/${tag}]<break time="0.5s" />`
  }).join('\n')

  const genLine = useMutation({
    mutationFn: () =>
      elevenLabsApi.generateAudio(sceneId, { stability: 0.5, similarityBoost: 0.75, style: 0.3 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['el-lines', sceneId] }),
  })

  const [results, setResults] = useState<{ shotNum: number; filePath: string }[]>([])
  const genAll = useMutation({
    mutationFn: () => elevenLabsApi.generateAudio(sceneId),
    onSuccess: data => setResults(data.map(r => ({ shotNum: r.shotNum, filePath: r.filePath }))),
  })

  return (
    <div className="rounded-lg border bg-slate-50 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-700">{speaker.name}</p>
        <div className="flex items-center gap-1.5">
          {speaker.voiceId
            ? <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-0.5">✓ Voice set</span>
            : <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">⚠ ยังไม่ได้ตั้ง Voice</span>
          }
        </div>
      </div>

      {/* Ready-to-paste script */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">Script (copy ไป ElevenLabs ได้เลย)</p>
          <CopyButton text={scriptText} label="copy script" />
        </div>
        <pre className="text-xs font-mono bg-white border rounded p-2 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
          {scriptText}
        </pre>
      </div>

      {/* Per-line list */}
      <div className="space-y-1">
        {myLines.map((line, i) => {
          const result = results.find(r => r.shotNum === line.shotNum)
          return (
            <div key={i} className="flex items-start gap-2 rounded bg-white border px-2 py-1.5">
              <span className="text-xs text-slate-400 shrink-0 mt-0.5">Shot {line.shotNum}</span>
              <span className="flex-1 text-xs text-slate-700 break-all">{line.text}</span>
              {result
                ? <audio controls src={result.filePath} className="h-6 w-32 shrink-0" />
                : speaker.voiceId && (
                  <button type="button" onClick={() => genLine.mutate()} disabled={genLine.isPending}
                    className="shrink-0 text-xs rounded bg-violet-600 text-white px-2 py-0.5 hover:bg-violet-700 disabled:opacity-40">
                    {genLine.isPending ? '…' : '▶'}
                  </button>
                )
              }
            </div>
          )
        })}
      </div>

      {/* Generate all button */}
      {speaker.voiceId && (
        <button type="button" onClick={() => genAll.mutate()} disabled={genAll.isPending}
          className="w-full rounded-lg bg-violet-600 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-40">
          {genAll.isPending ? 'กำลัง generate…' : '🎙 Generate ทุก line ของ ' + speaker.name}
        </button>
      )}
      {genAll.isError && <p className="text-xs text-red-600">{(genAll.error as Error).message}</p>}
    </div>
  )
}

function DialoguePanel({ scene }: { scene: Scene }) {
  const linesKey = ['el-lines', scene._id]

  const linesQuery = useQuery({
    queryKey: linesKey,
    queryFn: () => elevenLabsApi.getLines(scene._id),
    staleTime: 30_000,
  })

  const { lines = [], speakers = [] } = linesQuery.data ?? {}

  if (linesQuery.isLoading) return <div className="rounded-lg border bg-white px-4 py-3 text-sm text-slate-400">กำลังโหลด…</div>
  if (!lines.length) return (
    <div className="rounded-lg border bg-white px-4 py-3">
      <p className="text-sm font-medium">{scene.sceneCode} — {scene.title}</p>
      <p className="text-xs text-slate-400 mt-1">ไม่มีบทสนทนาในซีนนี้</p>
    </div>
  )

  return (
    <div className="rounded-lg border bg-white">
      <div className="px-4 py-3 border-b">
        <p className="text-sm font-medium">{scene.sceneCode} — {scene.title}</p>
        <p className="text-xs text-slate-500 mt-0.5">{lines.length} lines · {speakers.length} speakers</p>
      </div>


      {/* Per-speaker blocks */}
      <div className="p-3 space-y-3">
        {speakers.map(sp => (
          <SpeakerBlock key={sp.name} speaker={sp} lines={lines} sceneId={scene._id} />
        ))}
      </div>
    </div>
  )
}


// ---- Auto Generate Queue ----

type QueueItem = { scene: Scene; clip: Clip }
type ItemStatus = 'pending' | 'sending' | 'waiting' | 'done' | 'error'

function AutoGenQueue({ scenes, projectId, resources, settings, episodeId }: {
  scenes: Scene[]; projectId: string; resources: EpisodeImageResources
  settings?: RunningHubSettings; episodeId: string
}) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string; statuses: Record<string, ItemStatus> }>({
    done: 0, total: 0, current: '', statuses: {},
  })
  const abortRef = useRef(false)

  const clipsWithPrompts = scenes.flatMap(sc =>
    (sc.clips ?? []).filter(c => !c.stale && c.videoPrompt).map(c => ({ scene: sc, clip: c }))
  )

  const toggleScene = (sceneId: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(sceneId)) next.delete(sceneId)
      else next.add(sceneId)
      return next
    })
  }
  const toggleAll = () => {
    const allIds = scenes.filter(sc => (sc.clips ?? []).some(c => !c.stale && c.videoPrompt)).map(sc => sc._id)
    setSelected(prev => prev.size === allIds.length ? new Set() : new Set(allIds))
  }

  const queue: QueueItem[] = clipsWithPrompts.filter(({ scene }) => selected.has(scene._id))

  const pollUntilDone = useCallback(async (sceneId: string, clipCode: string, promptVersion: number) => {
    const jobKey = ['runninghub-job', sceneId, clipCode, promptVersion]
    for (let i = 0; i < 180; i++) {
      await new Promise(r => setTimeout(r, 5000))
      if (abortRef.current) return 'cancelled'
      const result = await runningHubApi.getJob(sceneId, clipCode)
      qc.setQueryData(jobKey, result)
      const status = result.job?.status
      if (status === 'succeeded' || status === 'failed' || status === 'cancelled') return status
    }
    return 'timeout'
  }, [qc])

  const start = async () => {
    if (!queue.length) return
    abortRef.current = false
    setRunning(true)
    const statuses: Record<string, ItemStatus> = {}
    queue.forEach(({ clip }) => { statuses[clip.clipCode] = 'pending' })
    setProgress({ done: 0, total: queue.length, current: '', statuses: { ...statuses } })

    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break
      const { scene, clip } = queue[i]
      const label = `${scene.sceneCode} · ${clip.clipCode}`
      statuses[clip.clipCode] = 'sending'
      setProgress(p => ({ ...p, current: label, statuses: { ...statuses } }))
      try {
        const body = await buildSendFormData(clip, projectId, resources)
        const result = await runningHubApi.send(scene._id, clip.clipCode, body)
        qc.setQueryData(['runninghub-job', scene._id, clip.clipCode, clip.promptVersion], result)
        void qc.invalidateQueries({ queryKey: ['runninghub-history', scene._id, clip.clipCode] })
        statuses[clip.clipCode] = 'waiting'
        setProgress(p => ({ ...p, statuses: { ...statuses } }))
        const finalStatus = await pollUntilDone(scene._id, clip.clipCode, clip.promptVersion ?? 1)
        statuses[clip.clipCode] = finalStatus === 'succeeded' ? 'done' : 'error'
      } catch {
        statuses[clip.clipCode] = 'error'
      }
      setProgress(p => ({ ...p, done: i + 1, statuses: { ...statuses } }))
      void qc.invalidateQueries({ queryKey: runningHubCountsKey(episodeId) })
    }
    setRunning(false)
    setProgress(p => ({ ...p, current: '' }))
  }

  const configured = !!settings?.keySet && !!settings.workflowId
  const allIds = scenes.filter(sc => (sc.clips ?? []).some(c => !c.stale && c.videoPrompt)).map(sc => sc._id)
  const allSelected = allIds.length > 0 && selected.size === allIds.length
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  const dotColor: Record<ItemStatus, string> = {
    pending: 'bg-slate-300', sending: 'bg-blue-500 animate-pulse',
    waiting: 'bg-yellow-400 animate-pulse', done: 'bg-green-500', error: 'bg-red-400',
  }

  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-blue-800">🚀 Auto Generate Queue</p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleAll}
            className="text-xs px-2 py-1 border rounded hover:bg-white">
            {allSelected ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
          </button>
          <button type="button" onClick={start}
            disabled={running || !queue.length || !configured}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
            {running ? `กำลัง gen… (${progress.done}/${progress.total})` : `▶ Generate ${queue.length} clips`}
          </button>
          {running && (
            <button type="button" onClick={() => { abortRef.current = true }}
              className="text-xs px-2 py-1 border border-red-300 text-red-600 rounded hover:bg-red-50">หยุด</button>
          )}
        </div>
      </div>

      {!configured && <p className="text-xs text-amber-700">ตั้งค่า RunningHub API Key และ Workflow ก่อนใช้งาน</p>}

      {/* Scene checkboxes */}
      <div className="flex flex-wrap gap-2">
        {scenes.map(sc => {
          const hasClips = (sc.clips ?? []).some(c => !c.stale && c.videoPrompt)
          const clipCount = (sc.clips ?? []).filter(c => !c.stale && c.videoPrompt).length
          return (
            <label key={sc._id} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs cursor-pointer select-none transition-colors ${
              selected.has(sc._id) ? 'border-blue-500 bg-white text-blue-700 font-medium' : 'border-slate-200 bg-white text-slate-600'
            } ${!hasClips ? 'opacity-40 cursor-not-allowed' : 'hover:border-blue-300'}`}>
              <input type="checkbox" className="accent-blue-600" checked={selected.has(sc._id)}
                disabled={!hasClips || running}
                onChange={() => toggleScene(sc._id)} />
              <span>{sc.sceneCode}</span>
              {clipCount > 0 && <span className="text-slate-400">{clipCount} clips</span>}
            </label>
          )
        })}
      </div>

      {/* Progress bar */}
      {progress.total > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>{progress.current || (progress.done === progress.total ? '✓ เสร็จแล้ว' : '')}</span>
            <span>{pct}% ({progress.done}/{progress.total})</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full rounded-full bg-blue-500 transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          {/* Per-clip status dots */}
          <div className="flex flex-wrap gap-1.5">
            {queue.map(({ clip }) => (
              <span key={clip.clipCode} className="flex items-center gap-1 text-xs text-slate-500">
                <span className={`inline-block h-2 w-2 rounded-full ${dotColor[progress.statuses[clip.clipCode] ?? 'pending']}`} />
                {clip.clipCode}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Main Step ----

export function VideoPromptsStep({ episodeId, projectId, resources, visible, onImages }: Props) {
  const [tab, setTab] = useState<'dy' | 'bgm' | 'dialogue'>('dy')
  const [showSetup, setShowSetup] = useState(false)

  const updatingRef = useIsMutating({ mutationKey: referenceUpdateKey(projectId) }) > 0
  const revisingPrompt = useIsMutating({ mutationKey: ['video-prompt-revision', episodeId] }) > 0
  const approvingScenes = useMutationState({
    filters: { mutationKey: shotApprovalKey(episodeId), status: 'pending' },
    select: mutation => mutation.state.variables,
  })

  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ['scenes', episodeId],
    queryFn: () => scenesApi.list(episodeId),
  })
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.list().then(list => list.find(p => p._id === projectId)),
  })
  const projectRatio = project?.styleGuide?.aspectRatio
  const settings = useQuery({ queryKey: runningHubSettingsKey, queryFn: runningHubApi.settings, refetchOnMount: 'always' })
  const generationCounts = useQuery({
    queryKey: runningHubCountsKey(episodeId),
    queryFn: () => runningHubApi.getCounts(episodeId),
    enabled: visible,
  })

  const subtitles = useMutation({
    mutationFn: async () => {
      if (resources.footagesStatus !== 'ready' && !await resources.enableFootages()) {
        throw new Error('อนุญาตให้เบราว์เซอร์บันทึกไฟล์ใน Footages แล้วลองอีกครั้ง')
      }
      try {
        return await saveEpisodeSubtitles(projectId, episodeId)
      } catch (error) {
        if (error instanceof DOMException) {
          throw new Error('บันทึกไฟล์ลง Footages ไม่สำเร็จ กรุณาตรวจโฟลเดอร์และสิทธิ์เขียนไฟล์')
        }
        throw error
      }
    },
  })
  const savedSubtitles = subtitles.data?.workspaceId === resources.workspaceId ? subtitles.data : undefined

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">ขั้น 7 – Video Prompts</h2>
          <p className="mt-1 text-sm text-gray-500">ส่งพรอมป์พร้อมภาพตามลำดับ Picture เพื่อสร้างคลิปใน RunningHub</p>
          {settings.data?.workflowId && <p className="mt-1 text-xs text-gray-600">Workflow {settings.data.workflowId} · ใช้ทุกโปรเจกต์</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {settings.data && <RunningHubConnection settings={settings.data} />}
          <button type="button" disabled={settings.isLoading} onClick={() => setShowSetup(true)}
            className="rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40">
            Setup RunningHub
          </button>
          <button type="button" onClick={() => subtitles.mutate()}
            disabled={!resources.folderName || resources.isLoading || !!resources.busy || isLoading ||
              !scenes.length || updatingRef || revisingPrompt || approvingScenes.length > 0 || subtitles.isPending}
            className="rounded-lg border border-blue-600 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-40">
            {subtitles.isPending ? 'กำลังส่งออกซับไตเติล…' : 'Export Subtitle'}
          </button>
        </div>
      </div>

      {visible && !resources.folderName && !resources.isLoading && (
        <p className="text-sm text-slate-600">
          <button type="button" onClick={onImages} className="font-medium text-blue-700 underline">เลือกโฟลเดอร์ในขั้น 5</button>{' '}
          เพื่อบันทึกไฟล์ซับไตเติลลง Footages
        </p>
      )}
      {visible && savedSubtitles && (
        <p role="status" className="break-words rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          บันทึกแล้ว · {savedSubtitles.cueCount} ช่วงซับไตเติล · <span className="font-medium">{savedSubtitles.path}</span>
        </p>
      )}
      {visible && subtitles.isError && <p role="alert" className="text-sm text-red-700">{subtitles.error.message}</p>}
      {settings.isError && (
        <p role="alert" className="text-sm text-red-700">
          โหลดการตั้งค่า RunningHub ไม่สำเร็จ{' '}
          <button type="button" className="underline" onClick={() => void settings.refetch()}>ลองอีกครั้ง</button>
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {([
          { key: 'dy', label: 'DY Prompts' },
          { key: 'bgm', label: '🎵 BGM' },
          { key: 'dialogue', label: '💬 Dialogue' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-purple-600 text-purple-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: DY Prompts */}
      {tab === 'dy' && (
        <div className="space-y-3">
          {!isLoading && scenes.length > 0 && (
            <AutoGenQueue scenes={scenes} projectId={projectId} resources={resources}
              settings={settings.data} episodeId={episodeId} />
          )}
          {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}
          {visible && updatingRef && <p role="status" className="text-sm text-blue-700">กำลังอัปเดต Video Prompt ของซีนที่ใช้ภาพอ้างอิงใหม่…</p>}
          {!isLoading && scenes.length === 0 && (
            <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มี scenes</div>
          )}
          {generationCounts.isError && (
            <p role="alert" className="text-sm text-red-700">
              โหลดจำนวนครั้งที่ Gen ไม่สำเร็จ{' '}
              <button type="button" className="underline" onClick={() => void generationCounts.refetch()}>ลองอีกครั้ง</button>
            </p>
          )}
          {scenes.map(sc => <SceneVideoPanel key={sc._id} scene={sc} projectId={projectId}
            generationCount={generationCounts.data && (generationCounts.data[sc._id] ?? 0)}
            updatingFromShots={approvingScenes.includes(sc._id) && needsDramaVideoPromptRefresh(sc)}
            resources={resources} settings={settings.data} visible={visible} onSetup={() => setShowSetup(true)} onImages={onImages} projectRatio={projectRatio} />)}
        </div>
      )}

      {/* Tab: BGM */}
      {tab === 'bgm' && (
        <div className="space-y-4">
          {/* Episode-level analysis */}
          {!isLoading && scenes.length > 0 && <EpisodeBgmPanel episodeId={episodeId} />}

          {/* Per-scene detailed sound design */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500">Sound Design รายละเอียดต่อ Scene</p>
            <p className="text-xs text-gray-400">สำหรับ SFX และ ambient sound แยกต่ละ scene</p>
            {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}
            {!isLoading && scenes.length === 0 && (
              <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มี scenes — รัน Scene Breakdown ก่อน</div>
            )}
            {scenes.map(sc => <BgmPanel key={sc._id} scene={sc} />)}
          </div>
        </div>
      )}

      {/* Tab: Dialogue */}
      {tab === 'dialogue' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">วิเคราะห์บทสนทนาจาก shots + voice profile ของตัวละคร — generate ElevenLabs script พร้อม emotion tags, timing และ voice direction แยกต่ละ scene</p>
          {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}
          {!isLoading && scenes.length === 0 && (
            <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มี scenes — รัน Scene Breakdown ก่อน</div>
          )}
          {scenes.map(sc => <DialoguePanel key={sc._id} scene={sc} />)}
        </div>
      )}

      {showSetup && <RunningHubSetup settings={settings.data} onClose={() => setShowSetup(false)} />}
    </div>
  )
}
