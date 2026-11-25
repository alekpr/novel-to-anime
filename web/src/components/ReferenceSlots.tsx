import type { Clip } from '../lib/api'
import { MAX_REFERENCE_AUDIOS, supportedReferenceImage } from '../../../src/utils/videoClipInputs'
import type { EpisodeImageResources } from '../features/images/useImageResources'
import { clipAudioSlots, clipImageSlots } from '../features/video/clipReferences'

const roleLabel = { character: 'ตัวละคร', location: 'สถานที่', prop: 'พร็อพ' }

export function ReferenceSlots({ clip, resources }: { clip: Clip; resources: EpisodeImageResources }) {
  const images = clipImageSlots(clip, resources)
  const { attached, missing, overLimit } = clipAudioSlots(clip, resources)
  if (!images.length && !attached.length && !missing.length) return null
  return (
    <div className="space-y-2 rounded border bg-gray-50 p-3 text-xs text-gray-700">
      <p className="font-medium">ไฟล์อ้างอิงที่ต้องแนบตามลำดับ</p>
      {images.length > 0 && (
        <ol className="space-y-1" aria-label="ภาพอ้างอิง">
          {images.map(({ index, name, role, key }) => {
            const ref = key ? resources.references[key] : undefined
            const status = resources.isLoading ? 'กำลังตรวจไฟล์' : ref?.status !== 'ready'
              ? 'ยังไม่ได้แนบ' : supportedReferenceImage(ref.file.name, ref.file.size) ? 'พร้อมแนบ' : 'ไฟล์ภาพไม่รองรับ'
            return (
              <li key={index} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono">Picture {index}</span>
                <span>{name} ({roleLabel[role]})</span>
                <span className={status === 'พร้อมแนบ' ? 'text-green-700' : 'text-slate-600'}>{status}</span>
              </li>
            )
          })}
        </ol>
      )}
      {attached.length > 0 && (
        <ol className="space-y-1" aria-label="เสียงอ้างอิง">
          {attached.map(({ charId, name }, i) => (
            <li key={charId} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono">Audio {i + 1}</span>
              <a className="underline" href={`/api/characters/${charId}/audio-reference`} download>{name}</a>
            </li>
          ))}
        </ol>
      )}
      {missing.length > 0 && <p className="text-slate-600">ยังไม่มีเสียงอ้างอิงสำหรับ {missing.map(char => char.name).join(', ')}</p>}
      {overLimit.length > 0 && (
        <p className="text-amber-800">แนบเสียงได้ {MAX_REFERENCE_AUDIOS} ไฟล์ต่อคลิป จึงข้าม {overLimit.map(char => char.name).join(', ')}</p>
      )}
    </div>
  )
}
