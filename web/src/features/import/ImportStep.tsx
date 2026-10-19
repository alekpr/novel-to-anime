import { useState } from 'react'
import { episodesApi } from '../../lib/api'

interface Props {
  projectId: string
  onDone: (episodeId: string) => void
}

export function ImportStep({ projectId, onDone }: Props) {
  const [number, setNumber] = useState(1)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length
  const paraCount = text.trim().split(/\n\s*\n/).filter(Boolean).length

  async function handleSubmit() {
    if (!text.trim()) return
    setLoading(true)
    setError('')
    try {
      const ep = await episodesApi.create(projectId, { number, title: title || `ตอนที่ ${number}`, text })
      onDone(ep._id)
    } catch (e: any) {
      setError(e.response?.data?.message ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setText(ev.target?.result as string)
    reader.readAsText(file, 'utf-8')
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-semibold">ขั้น 1 – นำเข้านิยาย</h2>

      <div className="flex gap-4">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-sm font-medium">หมายเลขตอน</span>
          <input
            type="number" min={1} value={number}
            onChange={e => setNumber(+e.target.value)}
            className="border rounded px-3 py-2 w-24"
          />
        </label>
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-sm font-medium">ชื่อตอน</span>
          <input
            type="text" value={title} placeholder={`ตอนที่ ${number}`}
            onChange={e => setTitle(e.target.value)}
            className="border rounded px-3 py-2"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">อัปโหลดไฟล์ .txt</span>
        <input type="file" accept=".txt" onChange={handleFile} className="text-sm" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">หรือวางข้อความนิยายที่นี่</span>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={12}
          placeholder="วางข้อความนิยายที่นี่…"
          className="border rounded px-3 py-2 font-mono text-sm resize-y"
        />
      </label>

      {text && (
        <div className="text-sm text-gray-500 bg-gray-50 rounded p-3">
          ประมาณ <strong>{wordCount.toLocaleString()}</strong> คำ · <strong>{paraCount}</strong> ย่อหน้า
        </div>
      )}

      {error && <div className="text-red-600 text-sm">{error}</div>}

      <button
        onClick={handleSubmit}
        disabled={!text.trim() || loading}
        className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
      >
        {loading ? 'กำลังบันทึก…' : 'บันทึกและไปขั้น Bible ▶'}
      </button>
    </div>
  )
}
