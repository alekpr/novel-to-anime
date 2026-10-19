import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AiLoadingBanner } from '../../components/AiLoadingBanner'
import { BadgeSource } from '../../components/BadgeSource'
import { JobProgressPanel } from '../../components/JobProgressPanel'
import { SourceTextPane } from '../../components/SourceTextPane'
import { useJobStream } from '../../hooks/useJobStream'
import { episodesApi, scenesApi, shotsApi } from '../../lib/api'
import type { Scene, Shot } from '../../lib/api'

interface Props {
  episodeId: string
  initialSceneId?: string
}

function DialogueLine({ shotId, idx, line, onUpdated }: {
  shotId: string; idx: number; line: Shot['dialogue'][number]; onUpdated: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(line.lineTh)
  const update = useMutation({
    mutationFn: (data: { reviewed?: boolean; lineTh?: string }) => shotsApi.updateDialogue(shotId, idx, data),
    onSuccess: () => { onUpdated(); setEditing(false) },
  })
  return (
    <div className={`rounded p-2 space-y-1 ${line.source === 'generated' && !line.reviewed ? 'bg-purple-50 border border-purple-200' : 'bg-gray-50'}`}>
      <div className="flex items-start gap-2">
        <BadgeSource label="" type={line.source === 'generated' ? 'generated' : 'original'} />
        <div className="flex-1 min-w-0">
          {editing
            ? <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} autoFocus
                className="w-full text-sm border rounded px-2 py-1 resize-none" />
            : <p className="text-sm">{line.lineTh}</p>
          }
          {line.tone && <p className="text-xs text-gray-400 italic">{line.tone}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          {editing ? (
            <>
              <button onClick={() => update.mutate({ lineTh: draft })} disabled={update.isPending}
                className="text-xs px-2 py-1 bg-blue-600 text-white rounded disabled:opacity-40">บันทึก</button>
              <button onClick={() => { setEditing(false); setDraft(line.lineTh) }}
                className="text-xs px-2 py-1 border rounded">ยกเลิก</button>
            </>
          ) : (
            <>
              {line.source === 'generated' && !line.reviewed && (
                <button onClick={() => update.mutate({ reviewed: true })} disabled={update.isPending}
                  className="text-xs px-2 py-1 bg-green-600 text-white rounded disabled:opacity-40">✔ ตรวจแล้ว</button>
              )}
              {line.source === 'generated' && line.reviewed && <span className="text-xs text-green-600">✔</span>}
              <button onClick={() => setEditing(true)} className="text-xs px-2 py-1 border rounded">แก้</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ShotRow({ shot, onUpdated }: { shot: Shot; onUpdated: () => void }) {
  const [open, setOpen] = useState(false)
  const unreviewed = shot.dialogue.filter(d => d.source === 'generated' && !d.reviewed).length
  const reviewAll = useMutation({ mutationFn: () => shotsApi.reviewAll(shot._id), onSuccess: onUpdated })
  const genDialogue = useMutation({ mutationFn: () => shotsApi.generateDialogue(shot._id), onSuccess: onUpdated })
  return (
    <div className="border rounded bg-white overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left">
        <span className="text-xs font-mono text-gray-400 w-28 shrink-0">{shot.shotCode}</span>
        <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded">{shot.shotType}</span>
        <span className="text-xs text-gray-500 flex-1 truncate">{shot.action}</span>
        <span className="text-xs text-gray-400">{shot.durationSec}s</span>
        {unreviewed > 0 && (
          <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">⚠ {unreviewed} ยังไม่ตรวจ</span>
        )}
        <span className="text-gray-400 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="border-t px-3 pb-3 pt-2 space-y-2">
          <div className="text-xs text-gray-500">{shot.camera}</div>
          {shot.dialogue.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <span className="text-xs font-medium text-gray-500">บทสนทนา</span>
                {unreviewed > 0 && (
                  <button onClick={() => reviewAll.mutate()} disabled={reviewAll.isPending}
                    className="text-xs px-2 py-1 border rounded disabled:opacity-40">✔ ตรวจทั้งหมด</button>
                )}
              </div>
              {shot.dialogue.map((d, i) => (
                <DialogueLine key={i} shotId={shot._id} idx={i} line={d} onUpdated={onUpdated} />
              ))}
            </div>
          )}
          {shot.dialogue.length === 0 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">ไม่มีบทสนทนา</span>
              <button
                onClick={() => genDialogue.mutate()}
                disabled={genDialogue.isPending}
                className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1"
              >
                {genDialogue.isPending
                  ? <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg> กำลังสร้าง…</>
                  : '🤖 สร้างบทพูด'
                }
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function ShotsStep({ episodeId, initialSceneId }: Props) {
  const qc = useQueryClient()
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(initialSceneId ?? null)
  const [jobId, setJobId] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const [filterUnreviewed, setFilterUnreviewed] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const streamJob = useJobStream(jobId)

  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', episodeId],
    queryFn: () => scenesApi.list(episodeId),
  })
  const { data: shots = [], isLoading: loadingShots } = useQuery({
    queryKey: ['shots', selectedSceneId],
    queryFn: () => shotsApi.list(selectedSceneId!),
    enabled: !!selectedSceneId,
  })
  const runS3 = useMutation({
    mutationFn: () => episodesApi.runStage(episodeId, 'S3'),
    onSuccess: (job) => { jobIdRef.current = job._id; setJobId(job._id) },
  })
  const genScene = useMutation({
    mutationFn: (sceneId: string) => shotsApi.generateForScene(sceneId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shots', selectedSceneId] }),
  })

  useEffect(() => {
    if (streamJob?.status === 'succeeded' && jobIdRef.current) {
      // invalidate shots ทุก scene ไม่ใช่แค่ scene ที่เลือก
      qc.invalidateQueries({ queryKey: ['shots'] })
      jobIdRef.current = null
      setJobId(null)
    }
  }, [streamJob?.status, qc])

  function invalidateShots() { qc.invalidateQueries({ queryKey: ['shots', selectedSceneId] }) }

  const selectedScene = scenes.find((s: Scene) => s._id === selectedSceneId)
  const unreviewedTotal = shots.filter(sh => sh.dialogue.some(d => d.source === 'generated' && !d.reviewed)).length
  const displayedShots = filterUnreviewed
    ? shots.filter(sh => sh.dialogue.some(d => d.source === 'generated' && !d.reviewed))
    : shots

  return (
    <div className="flex h-full min-h-0">
      {/* Scene sidebar */}
      <div className="w-56 border-r bg-gray-50 overflow-y-auto shrink-0">
        <div className="p-3 border-b text-sm font-medium text-gray-700">ฉากทั้งหมด ({scenes.length})</div>
        {scenes.map((sc: Scene) => (
          <button key={sc._id} onClick={() => setSelectedSceneId(sc._id)}
            className={`w-full text-left px-3 py-2 text-sm border-b hover:bg-white transition-colors
              ${selectedSceneId === sc._id ? 'bg-white border-l-2 border-l-blue-500 font-medium' : ''}`}>
            <div className="text-xs text-gray-400 font-mono">{sc.sceneCode}</div>
            <div className="truncate">{sc.title}</div>
            <div className="text-xs text-gray-400">{sc.estDurationSec}s</div>
          </button>
        ))}
      </div>

      {/* Shot list */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-w-0">
        <div className="flex justify-between items-center gap-2">
          <div>
            <h2 className="text-xl font-semibold">ขั้น 4 – Shots & บทสนทนา</h2>
            {selectedScene && <p className="text-sm text-gray-500">{selectedScene.title} · {shots.length} shots</p>}
          </div>
          <div className="flex gap-2 shrink-0">
            {selectedScene && (
              <button onClick={() => setShowSource(s => !s)}
                className={`text-sm px-3 py-1.5 border rounded hover:bg-gray-50 ${showSource ? 'bg-gray-100' : ''}`}>
                📄 ต้นฉบับ
              </button>
            )}
            <button onClick={() => runS3.mutate()} disabled={runS3.isPending || !!jobId}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40">
              {jobId ? '⏳ กำลังสร้าง…' : '🤖 สร้าง Shots ทั้งหมด'}
            </button>
            {selectedSceneId && (
              <button
                onClick={() => genScene.mutate(selectedSceneId)}
                disabled={genScene.isPending}
                className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1"
              >
                {genScene.isPending
                  ? <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg> กำลังสร้าง…</>
                  : '🎬 สร้าง Shots ฉากนี้'
                }
              </button>
            )}
          </div>
        </div>

        <AiLoadingBanner job={streamJob} label="AI กำลังสร้าง Shots" />

        {!selectedSceneId && (
          <div className="text-gray-500 text-sm bg-gray-50 rounded p-4">เลือกฉากจากรายการซ้ายมือ</div>
        )}
        {selectedSceneId && loadingShots && <div className="text-gray-400">กำลังโหลด…</div>}

        {shots.length > 0 && (
          <div className="flex items-center gap-3">
            {unreviewedTotal > 0 && (
              <span className="text-sm text-orange-600">⚠ {unreviewedTotal} บทพูดยังไม่ตรวจ</span>
            )}
            <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer ml-auto">
              <input type="checkbox" checked={filterUnreviewed} onChange={e => setFilterUnreviewed(e.target.checked)} />
              แสดงเฉพาะที่ยังไม่ตรวจ
            </label>
          </div>
        )}

        <div className="space-y-2">
          {displayedShots.map(sh => <ShotRow key={sh._id} shot={sh} onUpdated={invalidateShots} />)}
        </div>
      </div>

      {/* Source text pane */}
      {showSource && selectedScene && (
        <div className="w-72 border-l bg-gray-50 shrink-0 flex flex-col">
          <div className="flex justify-between items-center px-3 py-2 border-b bg-white shrink-0">
            <span className="text-xs font-medium text-gray-600">ต้นฉบับ</span>
            <button onClick={() => setShowSource(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SourceTextPane episodeId={episodeId} highlightRange={selectedScene.sourceRange} />
          </div>
        </div>
      )}

      <JobProgressPanel job={streamJob} onDismiss={() => setJobId(null)} />
    </div>
  )
}
