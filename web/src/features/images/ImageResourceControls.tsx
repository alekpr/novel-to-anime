import { useEffect, useId, useRef, useState } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import type { EpisodeImageResources } from './useImageResources'
import { referenceUpdateKey, updateReferencePrompt } from './updateReferencePrompt'

const actionButton = 'rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-blue-50 disabled:opacity-40'
const folderMessages: Partial<Record<EpisodeImageResources['folderStatus'], string>> = {
  permission: 'เบราว์เซอร์ขอสิทธิ์เข้าถึงโฟลเดอร์งานอีกครั้ง',
  missing: 'ไม่พบโฟลเดอร์งานหรือโฟลเดอร์ Images',
  unavailable: 'เปิดโฟลเดอร์งานไม่ได้ กรุณาตรวจตำแหน่งหรือเลือกโฟลเดอร์อีกครั้ง',
}

export function ImageWorkspaceControls({ resources }: { resources: EpisodeImageResources }) {
  const [mode, setMode] = useState<'closed' | 'choose' | 'create'>('closed')
  const [name, setName] = useState('')
  const folderName = name.trim()
  const validName = !!folderName && folderName !== '.' && folderName !== '..' && !/[/\\]/.test(folderName)
  const busy = resources.busy !== null
  const editing = !resources.folderName || mode !== 'closed'
  const creating = mode === 'create'
  const folderMessage = folderMessages[resources.folderStatus]

  function closeEditor() {
    setName('')
    setMode('closed')
  }

  async function selectFolder(newName?: string) {
    if (await resources.selectFolder(newName)) closeEditor()
  }

  return (
    <section aria-label="โฟลเดอร์งานภาพ" className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">โฟลเดอร์งานภาพ</h3>
        {resources.total > 0 && (
          <span className={`text-xs font-medium ${resources.complete ? 'text-green-700' : 'text-slate-600'}`}>
            {resources.complete && '✔ '}ภาพอ้างอิงพร้อม {resources.ready}/{resources.total}
          </span>
        )}
      </div>
      {resources.folderName && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words text-sm font-medium">
            {resources.folderStatus === 'ready' && <span aria-hidden="true" className="mr-1.5 text-green-700">✔</span>}
            {resources.folderName} / Images
          </p>
          {resources.supported && (
            <button type="button" className={actionButton} disabled={busy} aria-expanded={editing}
              onClick={() => editing ? closeEditor() : setMode('choose')}>{editing ? 'ยกเลิก' : 'แก้ไข'}</button>
          )}
        </div>
      )}
      {resources.footagesStatus === 'ready' && <p className="text-xs text-slate-600">วิดีโอบันทึกใน {resources.folderName} / Footages</p>}
      {resources.loadFailed && <p role="alert" className="text-sm text-red-700">โหลดข้อมูลภาพอ้างอิงไม่สำเร็จ</p>}
      {resources.isLoading && <p role="status" className="text-sm text-slate-600">กำลังตรวจภาพอ้างอิง…</p>}
      {!resources.supported ? (
        <p className="text-sm text-amber-800">เปิดแอปนี้ใน Chrome หรือ Edge เพื่อเลือกโฟลเดอร์และเชื่อมภาพอ้างอิง</p>
      ) : (
        <>
          {folderMessage && <p className="text-sm text-amber-800">{folderMessage}</p>}
          {resources.folderStatus === 'permission' && (
            <button type="button" className={actionButton} disabled={busy}
              onClick={() => void resources.reconnectFolder()}>อนุญาตเข้าถึงโฟลเดอร์</button>
          )}
          {resources.folderStatus === 'missing' && (
            <button type="button" className={actionButton} disabled={busy}
              onClick={() => void resources.restoreImagesFolder()}>สร้าง Images อีกครั้ง</button>
          )}
          {editing && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={actionButton} disabled={busy}
                onClick={() => void selectFolder()}>{resources.folderName ? 'เปลี่ยนโฟลเดอร์' : 'เลือกโฟลเดอร์'}</button>
              <button type="button" className={actionButton} disabled={busy} aria-expanded={creating}
                onClick={() => setMode(creating ? 'choose' : 'create')}>สร้างโฟลเดอร์ใหม่</button>
            </div>
          )}
          {creating && (
            <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
              event.preventDefault()
              if (validName) void selectFolder(folderName)
            }}>
              <label className="grid gap-1 text-xs font-medium">
                ชื่อโฟลเดอร์ใหม่
                <input value={name} required disabled={busy} onChange={event => setName(event.target.value)}
                  className="rounded-lg border px-3 py-1.5 text-sm font-normal" />
              </label>
              <button type="submit" className={actionButton} disabled={busy || !validName}>เลือกที่เก็บและสร้าง</button>
            </form>
          )}
        </>
      )}
      {resources.busy === 'folder' && <p role="status" className="text-xs text-slate-600">กำลังเชื่อมโฟลเดอร์…</p>}
      {resources.error?.target === 'folder' && <p role="alert" className="text-sm text-red-700">{resources.error.message}</p>}
      {resources.missing > 0 && (
        <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          หาไฟล์ภาพอ้างอิงไม่เจอ {resources.missing} รายการ ไฟล์อาจถูกย้ายหรือลบ เลือกภาพใหม่ที่ท้ายพรอมป์
        </p>
      )}
    </section>
  )
}

function ReferenceImagePreview({ file }: { file: File }) {
  const titleId = useId()
  const preview = useRef<HTMLImageElement>(null)
  const enlarged = useRef<HTMLImageElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    if (preview.current) preview.current.src = url
    if (dialog.current?.open && enlarged.current) enlarged.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  function showPreview() {
    const src = preview.current?.getAttribute('src')
    if (!src || !enlarged.current || !dialog.current || dialog.current.open) return
    enlarged.current.src = src
    dialog.current.showModal()
  }

  return (
    <>
      <button type="button" aria-label={`ดูภาพขนาดใหญ่ ${file.name}`} aria-haspopup="dialog"
        onClick={showPreview}
        className="w-36 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-slate-300 bg-slate-50 hover:border-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:w-48">
        <img ref={preview} alt="" className="block h-auto max-h-64 w-full object-contain" />
        <span className="block border-t border-slate-200 px-2 py-1.5 text-xs font-medium text-blue-700">ดูภาพใหญ่</span>
      </button>
      <dialog ref={dialog} aria-labelledby={titleId}
        onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close() }}
        onClose={() => { if (!dialog.current?.open) enlarged.current?.removeAttribute('src') }}
        className="m-auto w-[94vw] max-w-7xl overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-white shadow-2xl backdrop:bg-black/80">
        <div>
          <div className="flex items-center justify-between gap-3 border-b border-slate-700 px-3 py-2 sm:px-4">
            <h3 id={titleId} title={file.name} className="min-w-0 truncate text-sm font-medium">{file.name}</h3>
            <button type="button" autoFocus onClick={() => dialog.current?.close()}
              className="shrink-0 rounded-lg border border-slate-600 px-3 py-1.5 text-sm hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2">
              ปิด
            </button>
          </div>
          <img ref={enlarged} alt={file.name} className="block h-[min(75dvh,960px)] w-full object-contain p-2 sm:p-4" />
        </div>
      </dialog>
    </>
  )
}

export function ImageResourceSlot({ slotKey, resources }: { slotKey: string; resources: EpisodeImageResources }) {
  const qc = useQueryClient()
  const { projectId } = resources
  const reference = resources.references[slotKey]
  const file = reference?.status === 'ready' ? reference.file : undefined
  const mutationKey = referenceUpdateKey(projectId)
  const updatingRef = useIsMutating({ mutationKey }) > 0
  const updateRef = useMutation({
    mutationKey: [...mutationKey, slotKey],
    mutationFn: () => updateReferencePrompt(projectId, slotKey),
    onSuccess: ({ promptUpdates }) => {
      const episodeIds = new Set(promptUpdates.map(update => update.episodeId))
      return Promise.all([
        qc.invalidateQueries({ queryKey: ['characters', projectId] }),
        qc.invalidateQueries({ queryKey: ['locations', projectId] }),
        ...promptUpdates.map(update => qc.invalidateQueries({ queryKey: ['scene-clips', update.sceneId] })),
        ...[...episodeIds].flatMap(id => [
          qc.invalidateQueries({ queryKey: ['scenes', id] }),
          qc.invalidateQueries({ queryKey: ['episode-status', id] }),
        ]),
        ...(episodeIds.size > 0 ? [qc.invalidateQueries({ queryKey: ['episodes', projectId] })] : []),
      ])
    },
  })
  const busy = resources.busy !== null || updateRef.isPending
  const promptUpdates = updateRef.data?.promptUpdates ?? []
  const failed = promptUpdates.filter(update => update.error)
  const updated = promptUpdates.length - failed.length
  return (
    <div className="mt-2 flex flex-wrap items-start gap-3 rounded-lg border bg-white p-3">
      {file && <ReferenceImagePreview file={file} />}
      <div className="min-w-0 flex-1 basis-40 space-y-2">
        <div>
          <p className="text-xs font-medium">ภาพอ้างอิง</p>
          <p className={`mt-0.5 break-words text-xs ${reference?.status === 'ready' ? 'text-green-700' : reference ? 'text-amber-800' : 'text-slate-500'}`}>
            {reference?.status === 'ready' ? `✔ ${reference.name}`
              : reference?.status === 'missing' ? `หาไฟล์ไม่เจอ · ${reference.name}`
              : reference?.status === 'permission' ? `รอสิทธิ์เปิดไฟล์ · ${reference.name}`
              : reference ? `เปิดไฟล์ไม่ได้ · ${reference.name}` : 'ยังไม่ได้เลือกภาพ'}
          </p>
        </div>
        {resources.error?.target === slotKey && <p role="alert" className="text-xs text-red-700">{resources.error.message}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {reference?.status === 'permission' && (
            <button type="button" className={actionButton} disabled={busy}
              onClick={() => void resources.reconnectImage(slotKey)}>อนุญาตเปิดภาพ</button>
          )}
          <button type="button" className={actionButton} disabled={busy || !resources.canAttach}
            onClick={async () => { if (await resources.selectImage(slotKey)) updateRef.reset() }}>
            {resources.busy === slotKey ? 'กำลังเชื่อม…' : reference ? 'เปลี่ยนภาพ' : 'เลือกภาพ'}
          </button>
          {file && (
            <button type="button" className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
              title="วิเคราะห์ภาพและสร้าง Video Prompt ใหม่สำหรับซีนที่ใช้ภาพนี้" disabled={busy || updatingRef} onClick={() => updateRef.mutate()}>
              อัปเดต Ref
            </button>
          )}
          {reference && (
            <button type="button" className="px-1 py-1.5 text-xs text-slate-600 hover:underline disabled:opacity-40" disabled={busy}
              onClick={async () => { if (await resources.removeImage(slotKey)) updateRef.reset() }}>เลิกเชื่อมภาพ</button>
          )}
        </div>
        {updateRef.isPending && (
          <p role="status" className="flex items-center gap-2 text-xs text-blue-700">
            <span aria-hidden="true" className="size-3 animate-spin rounded-full border-2 border-current border-r-transparent" />
            กำลังอ่านภาพและรีเฟรช Video Prompt ของซีนที่ใช้ภาพนี้…
          </p>
        )}
        {updateRef.isError && <p role="alert" className="text-xs text-red-700">{updateRef.error.message}</p>}
        {updateRef.isSuccess && (
          <p role="status" className="text-xs text-green-700">
            อัปเดต Ref แล้ว
            {updated > 0 && ` · Video Prompt ใหม่ ${updated} ซีน ดูได้ในขั้น 7`}
            {promptUpdates.length === 0 && ' · ยังไม่มี Video Prompt ที่ใช้ภาพนี้'}
          </p>
        )}
        {failed.length > 0 && (
          <ul role="alert" className="space-y-0.5 text-xs text-amber-800">
            {failed.map(update => (
              <li key={update.sceneId}>{update.sceneCode} · {update.error}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
