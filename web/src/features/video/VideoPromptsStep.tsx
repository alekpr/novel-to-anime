import { useIsMutating, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { optimizeApi, promptsApi, scenesApi, shotApprovalKey } from '../../lib/api'
import { ReferenceSlots } from '../../components/ReferenceSlots'
import type { Clip, OptimizeResult, Scene } from '../../lib/api'
import type { EpisodeImageResources } from '../images/useImageResources'
import { referenceUpdateKey } from '../images/updateReferencePrompt'
import { RunningHubConnection, RunningHubSetup } from './RunningHubSetup'
import { RunningHubClip } from './RunningHubClip'
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

function SceneVideoPanel({ scene, projectId, resources, settings, generationCount, updatingFromShots, visible, onSetup, onImages }: {
  scene: Scene; projectId: string; resources: EpisodeImageResources; settings?: RunningHubSettings
  generationCount?: number
  updatingFromShots: boolean
  visible: boolean
  onSetup: () => void; onImages: () => void
}) {
  const [open, setOpen] = useState(false)
  const { data: sceneDetail } = useQuery({
    queryKey: ['scene-clips', scene._id],
    queryFn: () => promptsApi.getClips(scene._id),
    enabled: open,
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
          <div className="text-sm text-gray-400">ยังไม่มี clips — ไปขั้น 6 เพื่อสร้าง prompt ก่อน</div>
        )}
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
                <ReferenceSlots slots={clip.referenceSlots} />
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
                  settings={settings} visible={visible && open} onSetup={onSetup} onImages={onImages} />
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

// ---- Tab 2: H3 Optimizer ----

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

function ResultSections({ result, sceneCode }: { result: OptimizeResult; sceneCode: string }) {
  const parseFailed = !result.analysisReport && result.optimizedClips.every(c => !c)
  if (parseFailed) {
    return (
      <div className="space-y-2">
        <div className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded p-2">
          parse sections ไม่สำเร็จ — แสดง raw output ทั้งหมด
        </div>
        <Section title="Raw LLM Output" content={result.raw} mono filename={`${sceneCode}-RAW.md`} />
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <Section title="Prompt Analysis Report" content={result.analysisReport} filename={`${sceneCode}-ANALYSIS.md`} />
      <Section title="Subject & Picture Mapping" content={result.mappingTable} filename={`${sceneCode}-MAPPING.md`} />
      <Section title="Dialogue Timing Calibration" content={result.timingReport} filename={`${sceneCode}-TIMING.md`} />
      {result.optimizedClips.map((clip, i) => (
        <Section
          key={i}
          title={`Optimized H3 Prompt — Clip ${i + 1}/${result.optimizedClips.length}`}
          content={clip}
          mono
          badge={`Clip ${i + 1}`}
          filename={`${sceneCode}-C${String(i + 1).padStart(2, '0')}.md`}
        />
      ))}
      {result.elevenLabsScript && (
        <Section title="ElevenLabs Dialogue Script" content={result.elevenLabsScript} mono filename={`${sceneCode}-ELEVENLABS.md`} />
      )}
      <Section title="BGM Spec (แยกต่างหาก)" content={result.bgmSpec} filename={`${sceneCode}-BGM.md`} />
      <Section title="Validation Report" content={result.validationReport} filename={`${sceneCode}-VALIDATION.md`} />
    </div>
  )
}

function OptimizedPanel({ scene, maxClipSec, imageRefFormat }: {
  scene: Scene; maxClipSec: number | null; imageRefFormat: '@Image' | '<Picture>'
}) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const sceneCode = (scene as any).sceneCode ?? scene._id

  const { data: cached } = useQuery({
    queryKey: ['optimized', scene._id],
    queryFn: () => optimizeApi.getScene(scene._id),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  })

  const optimize = useMutation({
    mutationFn: () => optimizeApi.optimizeScene(scene._id, maxClipSec ?? undefined, imageRefFormat),
    onSuccess: (data) => { qc.setQueryData(['optimized', scene._id], data) },
  })

  const result: OptimizeResult | null = optimize.data ?? cached ?? null
  const hasClips = (scene as any).clips?.length > 0 || (scene as any).shotCount > 0

  return (
    <div className="border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-400">{sceneCode}</span>
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
              {optimize.isPending ? 'กำลัง optimize…' : result ? '↻ Optimize ใหม่' : 'Optimize H3 Prompt'}
            </button>
            {optimize.isError && (
              <span className="text-xs text-red-600">
                ✖ {String((optimize.error as any)?.response?.data?.error ?? optimize.error)}
              </span>
            )}
          </div>
          {result && <ResultSections result={result} sceneCode={sceneCode} />}
        </div>
      )}
    </div>
  )
}

// ---- Main Step ----

export function VideoPromptsStep({ episodeId, projectId, resources, visible, onImages }: Props) {
  const [tab, setTab] = useState<'dy' | 'optimizer'>('dy')
  const [showSetup, setShowSetup] = useState(false)
  const [maxClipSec, setMaxClipSec] = useState<string>('')
  const [imageRefFormat, setImageRefFormat] = useState<'@Image' | '<Picture>'>('@Image')
  const qc = useQueryClient()

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

  const optimizeAll = useMutation({
    mutationFn: async () => {
      const sec = maxClipSec ? Number(maxClipSec) : undefined
      for (const sc of scenes) {
        if ((sc as any).clips?.length > 0 || (sc as any).shotCount > 0) {
          await optimizeApi.optimizeScene(sc._id, sec, imageRefFormat)
          qc.invalidateQueries({ queryKey: ['optimized', sc._id] })
        }
      }
    },
  })
  const scenesWithClips = scenes.filter(sc => (sc as any).clips?.length > 0)

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
          { key: 'optimizer', label: 'H3 Optimizer' },
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
            updatingFromShots={approvingScenes.includes(sc._id)}
            resources={resources} settings={settings.data} visible={visible} onSetup={() => setShowSetup(true)} onImages={onImages} />)}
        </div>
      )}

      {/* Tab: H3 Optimizer */}
      {tab === 'optimizer' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center gap-4">
            <p className="text-xs text-gray-500">
              วิเคราะห์และ optimize DY prompt ตาม MiniMax H3 Validation Rules — แยก BGM, ElevenLabs script, ตรวจ dialogue timing
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1 border rounded px-2 py-1.5 bg-white text-xs">
                <span className="text-gray-500 mr-1">image ref:</span>
                {(['@Image', '<Picture>'] as const).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setImageRefFormat(fmt)}
                    className={`px-2 py-0.5 rounded font-mono ${
                      imageRefFormat === fmt ? 'bg-purple-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {fmt === '@Image' ? '@Image N' : '<Picture N>'}
                  </button>
                ))}
              </div>
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
                {optimizeAll.isPending ? 'กำลัง optimize…' : 'Optimize ทั้งหมด'}
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
                imageRefFormat={imageRefFormat}
              />
            ))}
          </div>
        </div>
      )}

      {showSetup && <RunningHubSetup settings={settings.data} onClose={() => setShowSetup(false)} />}
    </div>
  )
}
