import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import { projectsApi } from '../../lib/api'
import type { Project } from '../../lib/api'

export function RenameProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient()
  const ref = useRef<HTMLDialogElement>(null)
  const [title, setTitle] = useState(project.title)
  const newTitle = title.trim()
  const canSave = newTitle.length > 0 && newTitle !== project.title
  const rename = useMutation({
    mutationFn: (value: string) => projectsApi.rename(project._id, value),
    onSuccess: async updated => {
      await qc.cancelQueries({ queryKey: ['projects'], exact: true })
      qc.setQueryData<Project[]>(['projects'], current =>
        current?.map(item => item._id === updated._id ? updated : item),
      )
      onClose()
      void qc.invalidateQueries({ queryKey: ['projects'], exact: true })
    },
  })
  const error = isAxiosError<{ error?: string }>(rename.error) ? rename.error.response?.data?.error : undefined

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={ref}
      aria-labelledby="rename-project-title"
      onCancel={event => {
        event.preventDefault()
        if (!rename.isPending) onClose()
      }}
      className="m-auto w-11/12 max-w-md rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl backdrop:bg-slate-950/50 sm:p-6"
    >
      <form aria-busy={rename.isPending} className="space-y-4" onSubmit={event => {
        event.preventDefault()
        if (canSave && !rename.isPending) rename.mutate(newTitle)
      }}>
        <h2 id="rename-project-title" className="text-lg font-semibold">เปลี่ยนชื่อโปรเจกต์</h2>
        <label className="block text-sm font-medium text-slate-700">
          ชื่อโปรเจกต์
          <input autoFocus required value={title} disabled={rename.isPending}
            onFocus={event => event.currentTarget.select()}
            onChange={event => {
              setTitle(event.target.value)
              if (rename.isError) rename.reset()
            }}
            className="mt-1.5 w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-normal text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-60" />
        </label>
        {rename.isError && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            {error ?? 'เปลี่ยนชื่อโปรเจกต์ไม่สำเร็จ กรุณาลองอีกครั้ง'}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={rename.isPending}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50">ยกเลิก</button>
          <button type="submit" disabled={!canSave || rename.isPending}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
            {rename.isPending ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
