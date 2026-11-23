import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { promptsApi, scenesApi } from '../../lib/api'
import { ReferenceSlots } from '../../components/ReferenceSlots'
import type { Clip, Scene } from '../../lib/api'
import type { EpisodeImageResources } from '../images/useImageResources'
import { RunningHubConnection, RunningHubSetup } from './RunningHubSetup'
import { RunningHubClip } from './RunningHubClip'
import { runningHubApi, runningHubCountsKey, runningHubSettingsKey } from './runningHubApi'
import type { RunningHubSettings } from './runningHubApi'

interface Props {
  episodeId: string
  projectId: string
  resources: EpisodeImageResources
  visible: boolean
  onImages: () => void
}

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

function SceneVideoPanel({ scene, projectId, resources, settings, generationCount, visible, onSetup, onImages }: {
  scene: Scene; projectId: string; resources: EpisodeImageResources; settings?: RunningHubSettings
  generationCount?: number
  visible: boolean
  onSetup: () => void; onImages: () => void
}) {
  const [open, setOpen] = useState(false)
  const { data: sceneDetail } = useQuery({
    queryKey: ['scene-clips', scene._id],
    queryFn: () => promptsApi.getClips(scene._id),
    enabled: open,
  })

  const clips: Clip[] = (sceneDetail?.clips ?? scene.clips ?? []).filter(clip => !clip.stale)
  const hasPrompts = clips.some(c => c.videoPrompt)
  const allPrompts = clips.map(c => c.videoPrompt).filter(Boolean).join('\n\n---\n\n')

  return (
    <div className="border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-xs text-gray-400">{scene.sceneCode}</span>
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
          {clips.length === 0 && (
            <div className="text-sm text-gray-400">ยังไม่มี clips — ไปขั้น 6 เพื่อสร้าง prompt ก่อน</div>
          )}
          {clips.length > 1 && (
            <div className="flex justify-end">
              <CopyButton text={allPrompts} label={`copy ทั้ง ${clips.length} clips`} />
            </div>
          )}
          {clips.map((clip, i) => (
            <div key={clip.clipCode} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{clip.clipCode}</span>
                <span className="text-xs text-gray-500">{clip.durationSec}s{scene.dramaBeat && ` · ${clip.startOffsetSec}–${clip.startOffsetSec + clip.durationSec}s ของตอน`}</span>
                <span className="text-xs text-gray-400">คลิป {i + 1}/{clips.length} ของซีน</span>
                <span className="text-xs text-gray-400 ml-auto">v{clip.promptVersion}</span>
              </div>
              {clip.videoPrompt ? (
                <div className="space-y-2">
                  <ReferenceSlots slots={clip.referenceSlots} />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">{scene.dramaBeat ? 'MiniMax H3 · 9:16' : 'DY Prompt'}</span>
                    <CopyButton text={clip.videoPrompt} />
                  </div>
                  <pre className="text-xs bg-white border rounded p-3 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-80">
                    {clip.videoPrompt}
                  </pre>
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

export function VideoPromptsStep({ episodeId, projectId, resources, visible, onImages }: Props) {
  const [showSetup, setShowSetup] = useState(false)
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
        </div>
      </div>
      {settings.isError && (
        <p role="alert" className="text-sm text-red-700">
          โหลดการตั้งค่า RunningHub ไม่สำเร็จ{' '}
          <button type="button" className="underline" onClick={() => void settings.refetch()}>ลองอีกครั้ง</button>
        </p>
      )}
      {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}
      {!isLoading && scenes.length === 0 && (
        <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มี scenes</div>
      )}
      {generationCounts.isError && (
        <p role="alert" className="text-sm text-red-700">
          โหลดจำนวนครั้งที่ Gen ไม่สำเร็จ{' '}
          <button type="button" className="underline" onClick={() => void generationCounts.refetch()}>ลองอีกครั้ง</button>
        </p>
      )}
      <div className="space-y-3">
        {scenes.map(sc => <SceneVideoPanel key={sc._id} scene={sc} projectId={projectId}
          generationCount={generationCounts.data && (generationCounts.data[sc._id] ?? 0)}
          resources={resources} settings={settings.data} visible={visible} onSetup={() => setShowSetup(true)} onImages={onImages} />)}
      </div>
      {showSetup && <RunningHubSetup settings={settings.data} onClose={() => setShowSetup(false)} />}
    </div>
  )
}
