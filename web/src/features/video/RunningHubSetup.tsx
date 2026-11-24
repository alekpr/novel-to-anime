import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { runningHubApi, runningHubMessage, runningHubSettingsKey } from './runningHubApi'
import type { RunningHubSettings } from './runningHubApi'

const button = 'rounded-lg border px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-40'
const control = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'

export function RunningHubConnection({ settings }: { settings?: RunningHubSettings }) {
  const connected = settings?.connection === 'connected'
  const failed = settings?.connection === 'failed'
  const label = connected ? 'เชื่อมต่อแล้ว' : failed ? 'เชื่อมต่อไม่สำเร็จ' : settings?.workflowId ? 'ยังไม่ได้ทดสอบ' : 'ยังไม่ได้ตั้งค่า'
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
      connected ? 'bg-green-100 text-green-800' : failed ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'
    }`}>
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />{label}
    </span>
  )
}

export function RunningHubSetup({ settings, onClose }: { settings?: RunningHubSettings; onClose: () => void }) {
  const qc = useQueryClient()
  const ref = useRef<HTMLDialogElement>(null)
  const [key, setKey] = useState('')
  const [workflowId, setWorkflowId] = useState(settings?.workflowId ?? '')
  const [savedNow, setSavedNow] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  const save = useMutation({
    mutationFn: runningHubApi.saveSettings,
    gcTime: 0,
    onSuccess: result => {
      qc.setQueryData(runningHubSettingsKey, result)
      setKey('')
      setWorkflowId(result.workflowId)
      setSavedNow(true)
    },
  })
  const test = useMutation({
    mutationFn: runningHubApi.test,
    onSuccess: result => qc.setQueryData(runningHubSettingsKey, result),
  })

  const busy = save.isPending || test.isPending
  const changed = !!key.trim() || workflowId.trim() !== (settings?.workflowId ?? '')
  const canSave = changed && /^\d{1,30}$/.test(workflowId.trim()) && (!!key.trim() || !!settings?.keySet)
  const canTest = !changed && !!settings?.keySet && !!settings.workflowId
  const error = save.error || test.error

  function handleEdit() {
    setSavedNow(false)
    save.reset()
    test.reset()
  }

  return (
    <dialog ref={ref} aria-labelledby="runninghub-setup-title"
      className="m-auto w-11/12 max-w-lg rounded-xl border border-slate-200 bg-white text-slate-900 shadow-xl backdrop:bg-black/50"
      onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
      <form className="space-y-4 p-5 sm:p-6" onSubmit={event => {
        event.preventDefault()
        if (!busy && canSave) {
          test.reset()
          save.mutate({ workflowId: workflowId.trim(), ...(key.trim() && { apiKey: key.trim() }) })
        }
      }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="runninghub-setup-title" className="text-lg font-semibold">Setup RunningHub</h2>
          <RunningHubConnection settings={changed ? undefined : settings} />
        </div>
        <label className="grid gap-1 text-sm font-medium">
          RunningHub API Key
          <input autoFocus type="password" autoComplete="off" value={key} disabled={busy} className={control}
            placeholder={settings?.keySet ? 'บันทึกแล้ว · กรอกเพื่อเปลี่ยน' : 'ใส่ API Key'}
            onChange={event => { setKey(event.target.value); handleEdit() }} />
        </label>
        <label className="grid gap-1 text-sm font-medium">
          Workflow ID
          <input inputMode="numeric" autoComplete="off" value={workflowId} disabled={busy} className={control}
            onChange={event => { setWorkflowId(event.target.value); handleEdit() }} />
        </label>
        {savedNow && !changed && !test.isPending && !test.isSuccess && <p role="status" className="text-sm text-slate-600">บันทึกแล้ว ใช้การตั้งค่านี้ทุกโปรเจกต์</p>}
        {!changed && settings?.connectionMessage && (
          <p role={settings.connection === 'failed' ? 'alert' : undefined} className="text-sm text-amber-800">{settings.connectionMessage}</p>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{runningHubMessage(error, 'ตั้งค่า RunningHub ไม่สำเร็จ')}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={button} disabled={busy} onClick={onClose}>ปิด</button>
          <button type="button" className={button} disabled={busy || !canTest} onClick={() => { save.reset(); test.mutate() }}>
            {test.isPending ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ'}
          </button>
          <button type="submit" disabled={busy || !canSave}
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
            {save.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
