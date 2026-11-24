import { isAxiosError } from 'axios'
import api from '../../lib/api'
import { inspectImageWorkspace } from './imageResourceStore'

interface ReferenceUpdateResult {
  updated: boolean
  promptUpdates: { sceneId: string; episodeId: string; sceneCode: string; error?: string }[]
}

export const referenceUpdateKey = (projectId: string) => ['update-image-ref', projectId]

export async function updateReferencePrompt(projectId: string, slotKey: string) {
  const { references } = await inspectImageWorkspace(projectId, [slotKey])
  const ref = references[slotKey]
  if (ref?.status !== 'ready') throw new Error('เปิดไฟล์ภาพอ้างอิงไม่ได้ กรุณาตรวจหรือเลือกภาพอีกครั้ง')

  const bitmap = await createImageBitmap(ref.file).catch(() => {
    throw new Error('เบราว์เซอร์อ่านไฟล์ภาพนี้ไม่ได้ กรุณาเลือกภาพใหม่')
  })
  const canvas = document.createElement('canvas')
  try {
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height))
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('เตรียมภาพสำหรับวิเคราะห์ไม่สำเร็จ')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  } finally {
    bitmap.close()
  }
  const image = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!image) throw new Error('เตรียมภาพสำหรับวิเคราะห์ไม่สำเร็จ')

  try {
    const { data } = await api.post<ReferenceUpdateResult>(`/projects/${projectId}/image-reference`, image, {
      params: { key: slotKey },
      headers: { 'Content-Type': 'image/jpeg' },
    })
    return data
  } catch (error) {
    const message = isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined
    throw new Error(message || 'อัปเดตพรอมป์จากภาพไม่สำเร็จ กรุณาลองอีกครั้ง')
  }
}
