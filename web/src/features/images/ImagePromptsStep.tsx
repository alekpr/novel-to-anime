import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { charactersApi, episodesApi, locationsApi } from '../../lib/api'
import type { Character, Location } from '../../lib/api'

interface Props { projectId: string; episodeId: string }

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

function PromptBlock({ label, text, highlight }: { label: string; text: string; highlight?: boolean }) {
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

function CharCard({ char, currentEp, onRefresh }: { char: Character; currentEp: number; onRefresh: () => void }) {
  const [open, setOpen] = useState(false)
  const outfits = (char as any).outfits ?? []
  const isFirstEp = char.episodes?.[0] === currentEp
  const missingPrompts = outfits.filter((o: any) => !o.outfitPrompt || !o.outfitSheetPrompt)
  const hasNewOutfit = !isFirstEp && outfits.some((o: any) => !o.usedInScenes?.length)

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
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-2">
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
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {missingPrompts.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); genOutfits.mutate() }}
              disabled={genOutfits.isPending}
              className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1"
            >
              {genOutfits.isPending ? <><SpinIcon /> generating…</> : '🤖 Generate Outfit Prompts'}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); resetAppearance.mutate() }}
            disabled={resetAppearance.isPending}
            title="Reset appearanceBlock + characterSheetPrompt กลับไปยึดข้อมูลจากนิยายต้นฉบับ"
            className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-40 flex items-center gap-1"
          >
            {resetAppearance.isPending ? <><SpinIcon /> resetting…</> : '↩ Reset'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); regenAppearance.mutate() }}
            disabled={regenAppearance.isPending}
            title="Regenerate appearanceBlock + characterSheetPrompt ใหม่ โดยใส่ context ตัวละครอื่นเพื่อให้แตกต่างกัน"
            className="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-40 flex items-center gap-1"
          >
            {regenAppearance.isPending ? <><SpinIcon /> generating…</> : '🔄 Regen Appearance'}
          </button>
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t bg-white pt-3">

          {/* Outfit prompts — แยกต่อชุด */}
          {outfits.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Outfit Prompts</div>
              {outfits.map((o: any, i: number) => {
                const isNew = !o.usedInScenes?.length && !isFirstEp
                return (
                  <div key={i} className={`rounded-lg border p-3 space-y-2 ${isNew ? 'border-purple-200 bg-purple-50' : 'border-gray-100'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{o.name}</span>
                      {isNew && <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">ใหม่ EP{currentEp}</span>}
                      <span className="text-xs text-gray-400 flex-1 truncate">{o.description}</span>
                    </div>
                    {o.outfitPrompt
                      ? <PromptBlock label="Outfit Prompt (video/scene)" text={o.outfitPrompt} highlight={isNew} />
                      : <div className="text-xs text-orange-500">⚠ ยังไม่มี outfitPrompt</div>
                    }
                    {o.outfitSheetPrompt
                      ? <PromptBlock label="Character Sheet Prompt (ชุดนี้)" text={o.outfitSheetPrompt} highlight={isNew} />
                      : <div className="text-xs text-orange-500">⚠ ยังไม่มี outfitSheetPrompt</div>
                    }
                  </div>
                )
              })}
            </div>
          )}

          {/* Base appearance (ไม่มีชุด) */}
          <PromptBlock label="Appearance Block (base — ไม่มีชุด)" text={(char as any).appearanceBlock ?? ''} />
          <PromptBlock label="Character Sheet Prompt" text={(char as any).characterSheetPrompt ?? ''} />
          <PromptBlock label="Voice Prompt" text={char.voice?.voicePrompt ?? ''} />
        </div>
      )}
    </div>
  )
}

function LocCard({ loc, onRefresh }: { loc: Location; onRefresh: () => void }) {
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
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex justify-between items-center px-4 py-3 bg-white hover:bg-gray-50 text-left">
        <div className="flex items-center gap-2">
          <span className="font-medium">{loc.name}</span>
          <span className="text-xs text-gray-500">{loc.type}</span>
          {loc.status === 'approved' && <span className="text-green-600 text-xs">✔</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); resetPrompts.mutate() }}
            disabled={resetPrompts.isPending}
            title="Reset locationBlock + masterPrompt กลับไปยึดข้อมูลจากนิยายต้นฉบับ"
            className="text-xs px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600 disabled:opacity-40 flex items-center gap-1"
          >
            {resetPrompts.isPending ? <><SpinIcon /> resetting…</> : '↩ Reset'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); regenPrompts.mutate() }}
            disabled={regenPrompts.isPending}
            title="Regenerate locationBlock + masterPrompt ใหม่"
            className="text-xs px-2 py-1 bg-amber-500 text-white rounded hover:bg-amber-600 disabled:opacity-40 flex items-center gap-1"
          >
            {regenPrompts.isPending
              ? <><SpinIcon /> generating…</>
              : '🔄 Regen Prompts'
            }
          </button>
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t bg-white pt-3">
          <PromptBlock label="Location Block (ใส่ใน video prompt)" text={(loc as any).locationBlock ?? ''} />
          <PromptBlock label="Master Prompt" text={(loc as any).masterPrompt ?? ''} />
        </div>
      )}
    </div>
  )
}

export function ImagePromptsStep({ projectId, episodeId }: Props) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'chars' | 'locs'>('chars')

  const { data: episode } = useQuery({
    queryKey: ['episode', episodeId],
    queryFn: () => episodesApi.get(episodeId),
  })
  const currentEp = episode?.number ?? 0

  const { data: allChars = [] } = useQuery({ queryKey: ['characters', projectId], queryFn: () => charactersApi.list(projectId) })
  const { data: allLocs = [] } = useQuery({ queryKey: ['locations', projectId], queryFn: () => locationsApi.list(projectId) })
  const refreshChars = () => qc.invalidateQueries({ queryKey: ['characters', projectId] })
  const refreshLocs = () => qc.invalidateQueries({ queryKey: ['locations', projectId] })

  const chars = currentEp ? allChars.filter(c => c.episodes?.includes(currentEp)) : allChars
  const locs = currentEp ? allLocs.filter(l => l.episodes?.includes(currentEp)) : allLocs

  const charsWithNewOutfit = chars.filter(c => {
    const outfits = (c as any).outfits ?? []
    const isFirstEp = c.episodes?.[0] === currentEp
    return !isFirstEp && outfits.some((o: any) => !o.usedInScenes?.length)
  })

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <div>
        <h2 className="text-xl font-semibold">ขั้น 5 – Image Prompts</h2>
        <p className="text-sm text-gray-500 mt-1">copy prompt ไปใช้สร้างภาพด้วยโปรแกรมที่ต้องการ</p>
      </div>

      {charsWithNewOutfit.length > 0 && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-sm text-purple-800">
          ★ {charsWithNewOutfit.length} ตัวละครมีชุดใหม่ใน EP{currentEp}: {charsWithNewOutfit.map(c => c.name).join(', ')}
        </div>
      )}

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
        {tab === 'chars' && chars.map(c => <CharCard key={c._id} char={c} currentEp={currentEp} onRefresh={refreshChars} />)}
        {tab === 'locs' && locs.map(l => <LocCard key={l._id} loc={l} onRefresh={refreshLocs} />)}
        {tab === 'chars' && chars.length === 0 && (
          <div className="text-gray-400 text-sm bg-gray-50 rounded p-4">ยังไม่มีตัวละคร — รัน Bible ก่อน</div>
        )}
      </div>
    </div>
  )
}
