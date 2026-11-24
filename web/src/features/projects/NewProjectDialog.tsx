import { useMutation } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import { projectsApi } from '../../lib/api'
import type { CreateProjectInput, Project } from '../../lib/api'

const modes = [
  { id: 'manual', label: 'ใส่ตอนเอง', hint: 'เพิ่มทีละตอนภายหลัง' },
  { id: 'story', label: 'เรื่องเต็ม', hint: 'ให้ AI แบ่งต้นฉบับเป็นตอน' },
  { id: 'outline', label: 'โครงเรื่อง', hint: 'ให้ AI เขียนร่างตอน' },
] as const
type Mode = typeof modes[number]['id']

const inputStyle = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-normal text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100'

export function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (project: Project) => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<Mode>('manual')
  const [genre, setGenre] = useState('')
  const [episodeCount, setEpisodeCount] = useState('3')
  const [source, setSource] = useState({ story: '', outline: '' })
  const create = useMutation({ mutationFn: projectsApi.create, onSuccess: onCreated })
  const count = Number(episodeCount)
  const valid = !!title.trim() && (mode === 'manual' || (!!source[mode].trim() && Number.isSafeInteger(count) && count >= 1))
  const error = isAxiosError<{ error?: string; message?: string }>(create.error)
    ? create.error.response?.data?.error ?? create.error.response?.data?.message
    : undefined

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  function submit() {
    if (!valid || create.isPending) return
    const payload: CreateProjectInput = { title: title.trim() }
    if (mode !== 'manual') {
      payload.storySource = { mode, text: source[mode].trim(), episodeCount: count }
      if (genre.trim()) payload.genre = genre.trim()
    }
    create.mutate(payload)
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby="new-project-title"
      onCancel={event => {
        event.preventDefault()
        if (!create.isPending) onClose()
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-11/12 max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl backdrop:bg-slate-950/50"
    >
      <form onSubmit={event => { event.preventDefault(); submit() }} aria-busy={create.isPending}>
        <div className="border-b border-slate-100 px-5 py-5 sm:px-7">
          <h2 id="new-project-title" className="text-xl font-semibold">สร้างโปรเจกต์ใหม่</h2>
        </div>
        <fieldset disabled={create.isPending} className="space-y-5 px-5 py-5 sm:px-7">
          <label className="block text-sm font-medium text-slate-700">
            ชื่อโปรเจกต์
            <input autoFocus required value={title} onChange={event => setTitle(event.target.value)}
              placeholder="ชื่อเรื่องหรือชื่อโปรเจกต์" className={inputStyle} />
          </label>
          <fieldset className="grid gap-2 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium text-slate-700">เริ่มจาก</legend>
            {modes.map(item => (
              <label key={item.id} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition-colors
                ${mode === item.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 hover:bg-slate-50'} focus-within:ring-2 focus-within:ring-indigo-200`}>
                <input type="radio" name="project-mode" checked={mode === item.id} onChange={() => { setMode(item.id); create.reset() }}
                  className="mt-1 accent-indigo-600" />
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{item.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-600">{item.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {mode !== 'manual' && (
            <>
              <label className="block text-sm font-medium text-slate-700">
                {mode === 'story' ? 'เนื้อเรื่องทั้งหมด' : 'โครงเรื่องคร่าว ๆ'}
                <textarea required rows={7} value={source[mode]} onChange={event => setSource({ ...source, [mode]: event.target.value })}
                  placeholder={mode === 'story' ? 'วางเนื้อเรื่องตั้งแต่ต้นจนจบ…' : 'เล่าถึงตัวละครหลัก จุดเริ่ม ความขัดแย้ง และตอนจบที่ตั้งใจไว้…'}
                  className={`${inputStyle} h-32 resize-y leading-relaxed sm:h-44`} />
              </label>
              <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <div>
                  <label htmlFor="new-project-genre" className="block text-sm font-medium text-slate-700">
                    แนวละคร <span className="font-normal text-slate-500">(ไม่บังคับ)</span>
                  </label>
                  <input id="new-project-genre" value={genre} onChange={event => setGenre(event.target.value)}
                    aria-describedby="new-project-genre-hint" placeholder="เช่น โรแมนติกคอมเมดี้ ดราม่าครอบครัว สืบสวน"
                    className={inputStyle} />
                  <p id="new-project-genre-hint" className="mt-1.5 text-xs text-slate-600">เว้นว่างให้ AI เลือกแนวจากเรื่องที่กรอก</p>
                </div>
                <label className="block text-sm font-medium text-slate-700">
                  จำนวนตอนที่ต้องการ
                  <input type="number" inputMode="numeric" required min={1} step={1} value={episodeCount}
                    onChange={event => setEpisodeCount(event.target.value)} className={`${inputStyle} block max-w-36 tabular-nums`} />
                </label>
              </div>
            </>
          )}
        </fieldset>
        {create.isPending && mode !== 'manual' && (
          <p role="status" className="mx-5 mb-4 flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-sm text-indigo-800 sm:mx-7">
            <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-indigo-500 border-r-transparent" />
            {mode === 'story' ? 'AI กำลังหาจุดแบ่งต้นฉบับ…' : 'AI กำลังเขียนร่างแต่ละตอน…'}
          </p>
        )}
        {create.isError && (
          <p role="alert" className="mx-5 mb-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 sm:mx-7">
            {error ?? 'สร้างโปรเจกต์ไม่สำเร็จ กรุณาลองอีกครั้ง'}
          </p>
        )}
        <div className="sticky bottom-0 flex flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:px-7">
          <button type="button" onClick={onClose} disabled={create.isPending}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-100 disabled:opacity-50">ยกเลิก</button>
          <button type="submit" disabled={!valid || create.isPending}
            className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {create.isPending ? 'กำลังสร้าง…' : mode === 'manual' ? 'สร้างโปรเจกต์' : 'สร้างโปรเจกต์และจัดตอน'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
