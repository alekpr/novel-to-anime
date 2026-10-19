import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { promptsApi, scenesApi } from '../../lib/api'
import type { Scene } from '../../lib/api'

interface Props { episodeId: string }

interface Clip { clipCode: string; durationSec: number; videoPrompt: string; promptVersion: number }

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

function SceneVideoPanel({ scene }: { scene: Scene }) {
  const [open, setOpen] = useState(false)
  const { data: sceneDetail } = useQuery({
    queryKey: ['scene-clips', scene._id],
    queryFn: () => promptsApi.getClips(scene._id),
    enabled: open,
  })

  const clips: Clip[] = sceneDetail?.clips ?? []
  const hasPrompts = clips.some(c => c.videoPrompt)
  const allPrompts = clips.map(c => c.videoPrompt).filter(Boolean).join('\n\n---\n\n')

  return (
    <div className="border rounded-lg overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-gray-400">{scene.sceneCode}</span>
          <span className="font-medium">{scene.title}</span>
          <span className="text-xs text-gray-400">{scene.estDurationSec}s</span>
          {hasPrompts && (
            <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">✔ {clips.length} clips</span>
          )}
        </div>
        <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t bg-gray-50 px-4 pb-4 pt-3 space-y-4">
          {clips.length === 0 && (
            <div className="text-sm text-gray-400">ยังไม่มี clips — ไปขั้น 6 เพื่อสร้าง prompt ก่อน</div>
          )}
          {clips.length > 0 && (
            <div className="flex justify-end">
              <CopyButton text={allPrompts} label={`copy ทั้ง ${clips.length} clips`} />
            </div>
          )}
          {clips.map((clip, i) => (
            <div key={clip.clipCode} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium">{clip.clipCode}</span>
                <span className="text-xs text-gray-500">{clip.durationSec}s</span>
                <span className="text-xs text-gray-400">Clip {i + 1}/{clips.length}</span>
                <span className="text-xs text-gray-400 ml-auto">v{clip.promptVersion}</span>
              </div>
              {clip.videoPrompt ? (
                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-500">DY Prompt — ส่งไปสร้างวิดีโอ</span>
                    <CopyButton text={clip.videoPrompt} />
                  </div>
                  <pre className="text-xs bg-white border rounded p-3 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto max-h-80">
                    {clip.videoPrompt}
                  </pre>
                </div>
              ) : (
                <div className="text-xs text-gray-400 bg-white border rounded p-3">ยังไม่มี prompt</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function VideoPromptsStep({ episodeId }: Props) {
  const { data: scenes = [], isLoading } = useQuery({
    queryKey: ['scenes', episodeId],
    queryFn: () => scenesApi.list(episodeId),
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h2 className="text-xl font-semibold">ขั้น 7 – Video Prompts</h2>
        <p className="text-sm text-gray-500 mt-1">
          copy DY prompt ต่อ clip ไปใช้สร้างวิดีโอด้วยโปรแกรมที่ต้องการ (เช่น MiniMax H3, Kling, Runway)
        </p>
      </div>
      {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}
      {!isLoading && scenes.length === 0 && (
        <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มี scenes</div>
      )}
      <div className="space-y-3">
        {scenes.map(sc => <SceneVideoPanel key={sc._id} scene={sc} />)}
      </div>
    </div>
  )
}
