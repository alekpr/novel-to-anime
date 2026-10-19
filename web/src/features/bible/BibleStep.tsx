import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { AiLoadingBanner } from '../../components/AiLoadingBanner'
import { BadgeSource } from '../../components/BadgeSource'
import { JobProgressPanel } from '../../components/JobProgressPanel'
import { useJobStream } from '../../hooks/useJobStream'
import { charactersApi, episodesApi, locationsApi } from '../../lib/api'
import type { Character, Location } from '../../lib/api'

interface Props {
  projectId: string
  episodeId: string
  onDone: () => void
}

function EditableField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  return (
    <div className="flex gap-2 items-start">
      <span className="text-gray-400 w-24 shrink-0 text-sm">{label}</span>
      {editing ? (
        <div className="flex-1 flex gap-1">
          <input value={draft} onChange={e => setDraft(e.target.value)}
            className="flex-1 text-sm border rounded px-2 py-0.5" autoFocus />
          <button onClick={() => { onSave(draft); setEditing(false) }}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded">✔</button>
          <button onClick={() => { setDraft(value); setEditing(false) }}
            className="text-xs px-2 py-1 border rounded">✕</button>
        </div>
      ) : (
        <div className="flex-1 flex gap-1 items-center group">
          <span className="text-sm">{value || <span className="text-gray-300">—</span>}</span>
          <button onClick={() => setEditing(true)}
            className="text-xs text-gray-300 hover:text-gray-500 opacity-0 group-hover:opacity-100 ml-1">แก้</button>
        </div>
      )}
    </div>
  )
}

function CharCard({ char, onApprove, onUpdate, onDelete, currentEp }: {
  char: Character
  onApprove: () => void
  onUpdate: (data: Partial<Character>) => void
  onDelete: () => void
  currentEp: number
}) {
  const [open, setOpen] = useState(char.status !== 'approved')
  const inferred = char.appearance?.inferredFields ?? []
  const outfits = char.outfits ?? []
  // outfit ที่เพิ่งเข้ามาใน EP นี้ = usedInScenes ว่าง (ยังไม่ได้ assign) หรือดูจาก episodes
  const newOutfitThreshold = outfits.length > 1 ? outfits.slice(-Math.max(1, outfits.length - 1)) : []

  return (
    <div className={`border rounded-lg overflow-hidden ${char.status === 'approved' ? 'border-green-300' : char.needsReview ? 'border-orange-400' : ''}`}>
      <div className="flex justify-between items-center px-4 py-3 bg-white">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
          <span className="font-semibold">{char.name}</span>
          {char.aliases.length > 0 && <span className="text-xs text-gray-400">({char.aliases.join(', ')})</span>}
          <span className={`text-xs px-1.5 py-0.5 rounded ${char.role === 'main' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {char.role}
          </span>
          {char.needsReview && <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">⚠ ต้องตรวจ</span>}
          {outfits.length > 0 && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{outfits.length} ชุด</span>}
          <span className="text-gray-300 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </button>
        {char.status === 'approved'
          ? <span className="text-green-600 text-sm shrink-0">✔ อนุมัติแล้ว</span>
          : <div className="flex gap-1 shrink-0">
              <button onClick={onApprove} className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700">อนุมัติ</button>
              <button onClick={() => { if (confirm(`ลบ "${char.name}" ออกจาก Bible?`)) onDelete() }}
                className="text-sm px-2 py-1 text-red-500 border border-red-200 rounded hover:bg-red-50">✕</button>
            </div>
        }
      </div>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t bg-gray-50 space-y-3">
          {/* Appearance fields */}
          <div className="space-y-2">
            {char.appearance && Object.entries(char.appearance)
              .filter(([k]) => k !== 'inferredFields')
              .map(([k, v]) => (
                <div key={k} className="flex gap-2 items-center">
                  <EditableField
                    label={k}
                    value={String(v ?? '')}
                    onSave={(val) => onUpdate({ appearance: { ...char.appearance, [k]: val } as any })}
                  />
                  {inferred.includes(k) && <BadgeSource label="" type="inferred" />}
                </div>
              ))
            }
          </div>

          {/* Outfits */}
          {outfits.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">ชุดแต่งกาย</div>
              {outfits.map((o, i) => {
                const isNew = !o.usedInScenes || o.usedInScenes.length === 0
                return (
                  <div key={i} className={`text-sm rounded p-2 border ${isNew ? 'bg-purple-50 border-purple-200' : 'bg-white border-gray-100'}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{o.name}</span>
                      {isNew && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">ใหม่ EP{currentEp}</span>}
                    </div>
                    <div className="text-gray-500 text-xs mt-0.5">{o.description}</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Voice Prompt */}
          {char.voice?.voicePrompt && (
            <div className="text-xs text-gray-500 bg-white border rounded p-2">
              <span className="font-medium text-gray-400 block mb-1">Voice Prompt</span>
              {char.voice.voicePrompt}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function LocCard({ loc, onApprove, onUpdate }: {
  loc: Location
  onApprove: () => void
  onUpdate: (data: Partial<Location>) => void
}) {
  const [open, setOpen] = useState(loc.status !== 'approved')
  return (
    <div className={`border rounded-lg overflow-hidden ${loc.status === 'approved' ? 'border-green-300' : ''}`}>
      <div className="flex justify-between items-center px-4 py-3 bg-white">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 text-left">
          <span className="font-semibold">{loc.name}</span>
          <span className="text-xs text-gray-400">{loc.type}</span>
          <span className="text-gray-300 text-xs ml-1">{open ? '▲' : '▼'}</span>
        </button>
        {loc.status === 'approved'
          ? <span className="text-green-600 text-sm shrink-0">✔ อนุมัติแล้ว</span>
          : <button onClick={onApprove} className="text-sm px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 shrink-0">อนุมัติ</button>
        }
      </div>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t bg-gray-50 space-y-2">
          <EditableField label="description" value={loc.description ?? ''} onSave={v => onUpdate({ description: v })} />
        </div>
      )}
    </div>
  )
}

export function BibleStep({ projectId, episodeId, onDone }: Props) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'chars' | 'locs'>('chars')
  const [jobId, setJobId] = useState<string | null>(null)
  const jobIdRef = useRef<string | null>(null)
  const streamJob = useJobStream(jobId)

  const { data: episode } = useQuery({
    queryKey: ['episode', episodeId],
    queryFn: () => episodesApi.get(episodeId),
  })
  const currentEp = episode?.number ?? 0

  const { data: allChars = [], isLoading: loadingChars } = useQuery({
    queryKey: ['characters', projectId],
    queryFn: () => charactersApi.list(projectId),
  })
  const { data: allLocs = [], isLoading: loadingLocs } = useQuery({
    queryKey: ['locations', projectId],
    queryFn: () => locationsApi.list(projectId),
  })

  // กรองเฉพาะที่ปรากฏใน episode นี้
  const chars = currentEp ? allChars.filter(c => c.episodes?.includes(currentEp)) : allChars
  const locs = currentEp ? allLocs.filter(l => l.episodes?.includes(currentEp)) : allLocs

  const runS1 = useMutation({
    mutationFn: () => episodesApi.runStage(episodeId, 'S1'),
    onSuccess: (job) => { jobIdRef.current = job._id; setJobId(job._id) },
  })

  useEffect(() => {
    if (streamJob?.status === 'succeeded' && jobIdRef.current) {
      qc.invalidateQueries({ queryKey: ['characters', projectId] })
      qc.invalidateQueries({ queryKey: ['locations', projectId] })
      jobIdRef.current = null
      setJobId(null)
    }
  }, [streamJob?.status, projectId, qc])

  const approveChar = useMutation({
    mutationFn: (id: string) => charactersApi.approve(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters', projectId] }),
  })
  const approveLoc = useMutation({
    mutationFn: (id: string) => locationsApi.approve(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations', projectId] }),
  })
  const updateChar = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Character> }) => charactersApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters', projectId] }),
  })
  const updateLoc = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Location> }) => locationsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations', projectId] }),
  })
  const deleteChar = useMutation({
    mutationFn: (id: string) => charactersApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['characters', projectId] }),
  })

  const needsReviewChars = chars.filter(c => (c as any).needsReview)
  const allApproved = chars.length > 0 && chars.every(c => c.status === 'approved') && locs.every(l => l.status === 'approved')
  const pendingCount = chars.filter(c => c.status !== 'approved').length + locs.filter(l => l.status !== 'approved').length

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">ขั้น 2 – Story Bible</h2>
        <button
          onClick={() => runS1.mutate()}
          disabled={runS1.isPending || !!jobId}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
        >
          {jobId ? '⏳ กำลังวิเคราะห์…' : '🤖 ให้ AI วิเคราะห์'}
        </button>
      </div>

      {/* needsReview queue */}
      {needsReviewChars.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 space-y-2">
          <div className="text-sm font-medium text-orange-800">⚠ ต้องตัดสินใจ ({needsReviewChars.length} รายการ)</div>
          {needsReviewChars.map(c => (
            <div key={c._id} className="flex items-center gap-3 text-sm">
              <span className="font-medium">{c.name}</span>
              <span className="text-gray-500">อาจซ้ำกับตัวละครที่มีอยู่</span>
              <button onClick={() => approveChar.mutate(c._id)}
                className="ml-auto text-xs px-2 py-1 bg-green-600 text-white rounded">รวม/อนุมัติ</button>
            </div>
          ))}
        </div>
      )}

      <AiLoadingBanner job={streamJob} label="AI กำลังวิเคราะห์ตัวละครและสถานที่" />

      {chars.length === 0 && locs.length === 0 && !jobId && (
        <div className="text-gray-500 text-sm bg-gray-50 rounded p-4">
          กดปุ่ม "ให้ AI วิเคราะห์" เพื่อสกัดตัวละครและสถานที่จากนิยาย
        </div>
      )}

      {(chars.length > 0 || locs.length > 0) && (
        <>
          <div className="flex gap-2 border-b">
            {(['chars', 'locs'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
                  ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
                {t === 'chars' ? `ตัวละคร (${chars.length})` : `สถานที่ (${locs.length})`}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {tab === 'chars' && (loadingChars
              ? <div className="text-gray-400">กำลังโหลด…</div>
              : chars.map(c => (
                <CharCard key={c._id} char={c}
                  currentEp={currentEp}
                  onApprove={() => approveChar.mutate(c._id)}
                  onDelete={() => deleteChar.mutate(c._id)}
                  onUpdate={(data) => updateChar.mutate({ id: c._id, data })}
                />
              ))
            )}
            {tab === 'locs' && (loadingLocs
              ? <div className="text-gray-400">กำลังโหลด…</div>
              : locs.map(l => (
                <LocCard key={l._id} loc={l}
                  onApprove={() => approveLoc.mutate(l._id)}
                  onUpdate={(data) => updateLoc.mutate({ id: l._id, data })}
                />
              ))
            )}
          </div>

          {pendingCount > 0 && (
            <div className="text-sm text-orange-600 bg-orange-50 rounded p-3">
              ⚠ ยังมี {pendingCount} รายการที่ยังไม่อนุมัติ
            </div>
          )}

          <button
            onClick={onDone}
            disabled={!allApproved}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40"
          >
            อนุมัติ Bible และไปขั้น Scenes ▶
          </button>
        </>
      )}

      <JobProgressPanel job={streamJob} onDismiss={() => setJobId(null)} />
    </div>
  )
}
