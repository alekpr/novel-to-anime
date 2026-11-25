import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef } from 'react'
import { charactersApi, elevenLabsApi, locationsApi } from '../../lib/api'
import { characterReferenceSheet, locationReferenceSheet, propReferenceSheet } from '../../../../src/templates/referenceSheet'
import type { Character, Location, PropObject } from '../../lib/api'
import { ImageResourceSlot, ImageWorkspaceControls } from './ImageResourceControls'
import { characterImageKey, locationImageKey, outfitImageKeys, propImageKey } from './useImageResources'
import type { EpisodeImageResources } from './useImageResources'

interface Props { projectId: string; currentEp: number; resources: EpisodeImageResources }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={copy} className="text-xs px-2 py-1 border rounded hover:bg-gray-50 shrink-0">
      {copied ? '✔ copied' : 'copy'}
    </button>
  )
}

function PromptBlock({ label, text, highlight, reference }: {
  label: string; text: string; highlight?: boolean
  reference?: { slotKey: string; resources: EpisodeImageResources }
}) {
  if (!text) return null
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className={`text-xs font-medium uppercase tracking-wide ${highlight ? 'text-purple-600' : 'text-gray-500'}`}>
          {highlight && '★ '}{label}
        </span>
        <CopyButton text={text} />
      </div>
      <pre className={`text-xs border rounded p-3 whitespace-pre-wrap font-mono leading-relaxed overflow-x-auto
        ${highlight ? 'bg-purple-50 border-purple-200' : 'bg-gray-50'}`}>
        {text}
      </pre>
      {reference && <ImageResourceSlot {...reference} />}
    </div>
  )
}

function SpinIcon() {
  return (
    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

function CharCard({ char, currentEp, onRefresh, resources }: {
  char: Character; currentEp: number; onRefresh: () => void; resources: EpisodeImageResources
}) {
  const [open, setOpen] = useState(false)
  const outfits = char.outfits ?? []
  const outfitKeys = outfitImageKeys(char)
  const appearance = char.appearanceBlock ||
    [char.appearance?.hair, char.appearance?.skin, char.appearance?.eyes, char.appearance?.build].filter(Boolean).join(', ')
  const isFirstEp = char.episodes?.[0] === currentEp
  const missingPrompts = outfits.filter((o) => !o.outfitPrompt || !o.outfitSheetPrompt)
  const hasNewOutfit = !isFirstEp && outfits.some((o) => !o.usedInScenes?.length)

  const genOutfits = useMutation({
    mutationFn: () => charactersApi.generateOutfitPrompts(char._id),
    onSuccess: onRefresh,
  })

  const regenAppearance = useMutation({
    mutationFn: () => charactersApi.regenerateAppearance(char._id),
    onSuccess: onRefresh,
  })

  const resetAppearance = useMutation({
    mutationFn: () => charactersApi.resetAppearance(char._id),
    onSuccess: onRefresh,
  })

  return (
    <div className={`border rounded-lg overflow-hidden ${hasNewOutfit ? 'border-purple-300' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
          className="flex flex-1 flex-wrap items-center gap-2 text-left hover:text-blue-700">
          <span className="font-medium">{char.name}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${char.role === 'main' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {char.role}
          </span>
          {char.status === 'approved' && <span className="text-green-600 text-xs">✔</span>}
          {hasNewOutfit && (
            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
              ★ ชุดใหม่ EP{currentEp}
            </span>
          )}
          {missingPrompts.length > 0 && (
            <span className="text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">
              ⚠ {missingPrompts.length} ชุดไม่มี prompt
            </span>
          )}
          <span aria-hidden="true" className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {missingPrompts.length > 0 && (
            <button
              onClick={() => genOutfits.mutate()}
              disabled={genOutfits.isPending}
              className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1"
            >
              {genOutfits.isPending ? <><SpinIcon /> generating…</> : '🤖 Generate Outfit Prompts'}
            </button>
          )}
          <button
            onClick={() => resetAppearance.mutate()}
            disabled={resetAppearance.isPending}
            title="Reset appearanceBlock + characterSheetPrompt กลับไปยึดข้อมูลจากนิยายต้นฉบับ"
            className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-40 flex items-center gap-1"
          >
            {resetAppearance.isPending ? <><SpinIcon /> resetting…</> : '↩ Reset'}
          </button>
          <button
            onClick={() => regenAppearance.mutate()}
            disabled={regenAppearance.isPending}
            title="Regenerate appearanceBlock + characterSheetPrompt ใหม่ โดยใส่ context ตัวละครอื่นเพื่อให้แตกต่างกัน"
            className="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-40 flex items-center gap-1"
          >
            {regenAppearance.isPending ? <><SpinIcon /> generating…</> : '🔄 Regen Appearance'}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t bg-white pt-3">

          {/* Outfit prompts — แยกต่อชุด */}
          {outfits.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Outfit Prompts</div>
              {outfits.map((o, i) => {
                const isNew = !o.usedInScenes?.length && !isFirstEp
                return (
                  <div key={outfitKeys[i]} className={`rounded-lg border p-3 space-y-2 ${isNew ? 'border-purple-200 bg-purple-50' : 'border-gray-100'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{o.name}</span>
                      {isNew && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">ใหม่ EP{currentEp}</span>}
                      <span className="text-xs text-gray-400 flex-1 truncate">{o.description}</span>
                    </div>
                    {o.outfitPrompt
                      ? <PromptBlock label="Outfit Prompt (video/scene)" text={[o.referenceAppearance, o.outfitPrompt].filter(Boolean).join('\n')} highlight={isNew} />
                      : <div className="text-xs text-orange-500">⚠ ยังไม่มี outfitPrompt</div>
                    }
                    <PromptBlock label="Character Reference 2×2" text={characterReferenceSheet(char.name, o.referenceAppearance || appearance, o.outfitPrompt || o.description)} highlight={isNew}
                      reference={{ slotKey: outfitKeys[i], resources }} />
                  </div>
                )
              })}
            </div>
          )}

          {/* Base appearance (ไม่มีชุด) */}
          <PromptBlock label="Appearance Block (base — ไม่มีชุด)" text={appearance} />
          {!outfits.length && <PromptBlock label="Character Reference 2×2" text={characterReferenceSheet(char.name, appearance, char.referenceWardrobe || char.appearance?.defaultOutfit || '')}
            reference={{ slotKey: characterImageKey(char._id), resources }} />}
          <PromptBlock label="Voice Prompt" text={char.voice?.voicePrompt ?? ''} />
        </div>
      )}
    </div>
  )
}

function PropCard({ prop, resources }: { prop: PropObject; resources: EpisodeImageResources }) {
  const [open, setOpen] = useState(false)
  const slotKey = propImageKey(prop._id)
  return (
    <div className="border rounded-lg overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex flex-1 w-full flex-wrap items-center gap-2 px-4 py-3 bg-white text-left hover:text-blue-700">
        <span className="font-medium">{prop.name}</span>
        <span className="text-xs text-gray-400">{prop.category}</span>
        {prop.status === 'approved' && <span className="text-green-600 text-xs">✔</span>}
        <span aria-hidden="true" className="text-gray-400 text-sm ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t bg-white pt-3">
          {prop.description && <p className="text-xs text-gray-500">{prop.description}</p>}
          <PromptBlock label="Visual Prompt" text={prop.visualPrompt} />
          <PromptBlock label="Prop Reference 2×2" text={propReferenceSheet(prop.name, prop.visualPrompt)}
            reference={{ slotKey, resources }} />
        </div>
      )}
    </div>
  )
}

function ElevenLabsVoiceField({ char, onRefresh }: { char: Character; onRefresh: () => void }) {
  const [input, setInput] = useState(char.voice?.elevenLabsVoiceId ?? '')
  const [saved, setSaved] = useState(false)
  const save = useMutation({
    mutationFn: (voiceId: string) => elevenLabsApi.setVoice(char._id, voiceId),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); onRefresh() },
  })
  const current = char.voice?.elevenLabsVoiceId ?? ''
  const dirty = input.trim() !== current
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">ElevenLabs Voice ID</span>
        {current && <span className="text-xs text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">✓ ตั้งค่าแล้ว</span>}
      </div>
      <div className="flex gap-1.5">
        <input type="text" value={input} onChange={e => setInput(e.target.value)}
          placeholder="วาง Voice ID จาก elevenlabs.io/app/voice-lab"
          className="flex-1 rounded border px-2 py-1.5 text-xs font-mono text-slate-700 placeholder:text-slate-300"
        />
        <button type="button"
          onClick={() => save.mutate(input.trim())}
          disabled={save.isPending || !dirty}
          className="shrink-0 rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40">
          {save.isPending ? '…' : saved ? '✓' : 'บันทึก'}
        </button>
        {current && (
          <button type="button" onClick={() => { setInput(''); save.mutate('') }}
            disabled={save.isPending}
            className="shrink-0 rounded border border-red-200 px-2 py-1.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-40">✕</button>
        )}
      </div>
      {save.isError && <p className="text-xs text-red-600">{(save.error as any)?.response?.data?.error ?? 'บันทึกไม่สำเร็จ'}</p>}
      <p className="text-xs text-slate-400">หา Voice ID ได้ที่ elevenlabs.io → Voices → คลิก voice → copy ID ใต้ชื่อ</p>
    </div>
  )
}

function CharAudioCard({ char, onRefresh }: { char: Character; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()
  const hasAudio = !!char.voice?.audioReference
  const audioLines = char.voice?.audioLines ?? []
  const regenVoice = useMutation({
    mutationFn: () => charactersApi.regenerateVoicePrompt(char._id),
    onSuccess: onRefresh,
  })

  async function handleUpload(file: File) {
    setUploading(true); setUploadError(null)
    try {
      await charactersApi.uploadAudio(char._id, file)
      await qc.invalidateQueries({ queryKey: ['characters'] })
      onRefresh()
    } catch (e: any) {
      setUploadError(e?.response?.data?.error ?? 'อัปโหลดไม่สำเร็จ')
    } finally { setUploading(false) }
  }

  async function handleDelete() {
    if (!confirm(`ลบไฟล์เสียงของ "${char.name}"?`)) return
    setUploading(true); setUploadError(null)
    try {
      await charactersApi.deleteAudio(char._id)
      await qc.invalidateQueries({ queryKey: ['characters'] })
      onRefresh()
    } catch (e: any) {
      setUploadError(e?.response?.data?.error ?? 'ลบไม่สำเร็จ')
    } finally { setUploading(false) }
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="flex flex-1 w-full flex-wrap items-center gap-2 px-4 py-3 bg-white text-left hover:text-blue-700">
        <span className="font-medium">{char.name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${char.role === 'main' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{char.role}</span>
        {audioLines.length > 0
          ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">💬 {audioLines.length} บรรทัด</span>
          : <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">⚠ ยังไม่มีบทพูด</span>
        }
        {hasAudio
          ? <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">🎙 Audio ref พร้อม</span>
          : <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">🎙 ยังไม่มี audio</span>
        }
        <span aria-hidden="true" className="text-gray-400 text-sm ml-auto">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t bg-white pt-3">
          {/* บทพูด */}
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">บทพูดอ้างอิงเสียง</span>
            <button onClick={() => regenVoice.mutate()} disabled={regenVoice.isPending}
              className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1">
              {regenVoice.isPending ? <><SpinIcon /> generating…</> : '✨ Generate บทพูด'}
            </button>
          </div>
          {audioLines.length === 0
            ? <p className="text-xs text-gray-400 bg-gray-50 rounded px-3 py-2">กด Generate บทพูด เพื่อสร้างบทพูด + emotion tags</p>
            : (
              <div className="space-y-2">
                {audioLines.map((l, i) => (
                  <div key={i} className="flex gap-2 items-start bg-gray-50 rounded px-3 py-2">
                    <span className="text-xs font-mono bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded shrink-0">{l.tag}</span>
                    <span className="text-sm">{l.line}</span>
                  </div>
                ))}
              </div>
            )
          }
          {char.voice?.voicePrompt && <p className="text-xs text-gray-500 italic">🎙 {char.voice.voicePrompt}</p>}
          {/* ElevenLabs Voice ID */}
          <div className="border-t pt-3">
            <ElevenLabsVoiceField char={char} onRefresh={onRefresh} />
          </div>
          {/* Upload audio ref */}
          <div className="border-t pt-3">
            <input ref={inputRef} type="file" accept=".mp3,.wav,.m4a,.aac,.ogg,.flac" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Audio Reference:</span>
              {hasAudio ? (
                <>
                  <span className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">🎙 พร้อม</span>
                  <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
                    className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40">
                    {uploading ? 'อัปโหลด…' : '↑ เปลี่ยนไฟล์'}
                  </button>
                  <button type="button" onClick={handleDelete} disabled={uploading}
                    className="text-xs px-2 py-1 text-red-500 border border-red-200 rounded hover:bg-red-50 disabled:opacity-40">✕</button>
                </>
              ) : (
                <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
                  className="text-xs px-2 py-1 border border-dashed border-gray-300 rounded hover:bg-gray-50 disabled:opacity-40 text-gray-500">
                  {uploading ? 'อัปโหลด…' : '🎙 Upload Audio Ref'}
                </button>
              )}
              {uploadError && <span className="text-xs text-red-600">{uploadError}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LocCard({ loc, onRefresh, resources }: { loc: Location; onRefresh: () => void; resources: EpisodeImageResources }) {
  const [open, setOpen] = useState(false)

  const regenPrompts = useMutation({
    mutationFn: () => locationsApi.regeneratePrompts(loc._id),
    onSuccess: onRefresh,
  })

  const resetPrompts = useMutation({
    mutationFn: () => locationsApi.resetPrompts(loc._id),
    onSuccess: onRefresh,
  })

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-4 py-3">
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}
          className="flex flex-1 flex-wrap items-center gap-2 text-left hover:text-blue-700">
          <span className="font-medium">{loc.name}</span>
          <span className="text-xs text-gray-500">{loc.type}</span>
          {loc.status === 'approved' && <span className="text-green-600 text-xs">✔</span>}
          <span aria-hidden="true" className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => resetPrompts.mutate()}
            disabled={resetPrompts.isPending}
            title="Reset locationBlock + masterPrompt กลับไปยึดข้อมูลจากนิยายต้นฉบับ"
            className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-40 flex items-center gap-1"
          >
            {resetPrompts.isPending ? <><SpinIcon /> resetting…</> : '↩ Reset'}
          </button>
          <button
            onClick={() => regenPrompts.mutate()}
            disabled={regenPrompts.isPending}
            title="Regenerate locationBlock + masterPrompt ใหม่"
            className="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-40 flex items-center gap-1"
          >
            {regenPrompts.isPending
              ? <><SpinIcon /> generating…</>
              : '🔄 Regen Prompts'
            }
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t bg-white pt-3">
          <PromptBlock label="Location Block (ใส่ใน video prompt)" text={loc.locationBlock ?? ''} />
          <PromptBlock label="Location Reference 2×2" text={locationReferenceSheet(loc.name, loc.locationBlock || loc.description || loc.masterPrompt || '')}
            reference={{ slotKey: locationImageKey(loc._id), resources }} />
        </div>
      )}
    </div>
  )
}

export function ImagePromptsStep({ projectId, currentEp, resources }: Props) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'chars' | 'locs' | 'props' | 'audio'>('chars')

  const refreshChars = () => qc.invalidateQueries({ queryKey: ['characters', projectId] })
  const refreshLocs = () => qc.invalidateQueries({ queryKey: ['locations', projectId] })
  const { chars, locs, props } = resources

  const charsWithNewOutfit = chars.filter(c => {
    const outfits = c.outfits ?? []
    const isFirstEp = c.episodes?.[0] === currentEp
    return !isFirstEp && outfits.some((o) => !o.usedInScenes?.length)
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h2 className="text-xl font-semibold">ขั้น 5 – Image Prompts</h2>
        <p className="text-sm text-gray-500 mt-1">คัดลอกพรอมป์ Reference 2×2 แล้วเชื่อมไฟล์ภาพที่ท้ายพรอมป์</p>
      </div>

      <ImageWorkspaceControls resources={resources} />

      {charsWithNewOutfit.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
          ★ {charsWithNewOutfit.length} ตัวละครมีชุดใหม่ใน EP{currentEp}: {charsWithNewOutfit.map(c => c.name).join(', ')}
        </div>
      )}

      <div className="flex gap-2 border-b">
        {([
          { key: 'chars', label: `ตัวละคร (${chars.length})` },
          { key: 'locs', label: `สถานที่ (${locs.length})` },
          { key: 'props', label: `สิ่งของ (${props.length})` },
          { key: 'audio', label: `Audio Ref (${chars.length})` },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors
              ${tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        {tab === 'chars' && chars.map(c => <CharCard key={c._id} char={c} currentEp={currentEp} resources={resources} onRefresh={refreshChars} />)}
        {tab === 'locs' && locs.map(l => <LocCard key={l._id} loc={l} resources={resources} onRefresh={refreshLocs} />)}
        {tab === 'props' && (
          props.length === 0
            ? <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มีสิ่งของ — รัน Bible เพื่อสกัด props ก่อน</div>
            : props.map(p => <PropCard key={p._id} prop={p} resources={resources} />)
        )}
        {tab === 'audio' && (
          chars.length === 0
            ? <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มีตัวละคร — รัน Bible ก่อน</div>
            : chars.map(c => <CharAudioCard key={c._id} char={c} onRefresh={refreshChars} />)
        )}
        {!resources.isLoading && tab === 'chars' && chars.length === 0 && (
          <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มีตัวละคร — รัน Bible ก่อน</div>
        )}
      </div>
    </div>
  )
}
