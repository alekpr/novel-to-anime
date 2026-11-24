import type { Clip } from '../lib/api'

export function ReferenceSlots({ slots }: { slots: Clip['referenceSlots'] }) {
  if (!slots?.length) return null
  return (
    <div className="rounded border bg-gray-50 p-3 text-xs text-gray-700">
      <p className="font-medium mb-1.5">แนบภาพอ้างอิงตามลำดับนี้ใน MiniMax H3</p>
      <ol className="space-y-1">
        {slots.map(({ index, name }) => (
          <li key={index}><span className="font-mono">Picture {index}</span> · {name}</li>
        ))}
      </ol>
    </div>
  )
}
