import { getWorkspace, updateWorkspace } from '../images/imageResourceStore'

async function openFootages(projectId: string) {
  const workspace = await getWorkspace(projectId)
  if (!workspace || await workspace.folder.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    throw new Error('อนุญาตให้แอปบันทึกไฟล์ในโฟลเดอร์ Footages ก่อน')
  }
  const directory = await workspace.folder.getDirectoryHandle('Footages', { create: true })
  return { workspace, directory }
}

async function fileIn(directory: FileSystemDirectoryHandle, name: string) {
  try {
    return await directory.getFileHandle(name)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return undefined
    throw error
  }
}

export function saveFootage(projectId: string, sceneCode: string, clipCode: string, jobId: string, index: number) {
  return navigator.locks.request(`novel-footages:${projectId}`, async () => {
    const { workspace, directory } = await openFootages(projectId)
    const key = `${jobId}:${index}`
    const names = workspace.footageNames ?? {}
    const clipSuffix = clipCode.match(/-C(\d+)$/)?.[1]
    const nameBase = (sceneCode + (clipSuffix && Number(clipSuffix) > 1 ? `-C${clipSuffix}` : ''))
      .replace(/[^a-z0-9_-]/gi, '-') || 'Video'
    let filename = names[key]
    if (!filename) {
      const reserved = new Set(Object.values(names))
      filename = `${nameBase}.mp4`
      for (let i = 2; reserved.has(filename) || await fileIn(directory, filename); i++) {
        filename = `${nameBase}-${String(i).padStart(2, '0')}.mp4`
      }
      await updateWorkspace(projectId, stored => stored && stored.workspaceId === workspace.workspaceId ? {
        ...stored, footageNames: { ...stored.footageNames, [key]: filename },
      } : undefined)
    }
    const existing = await fileIn(directory, filename)
    if (existing) {
      const file = await existing.getFile()
      if (file.size > 0) return file
    }
    const response = await fetch(`/api/runninghub/jobs/${encodeURIComponent(jobId)}/footage/${index}`)
    if (!response.ok) {
      const details = await response.json().catch(() => null)
      throw new Error(details?.error || 'ดาวน์โหลดวิดีโอไม่สำเร็จ')
    }
    if (!response.body || response.headers.get('Content-Type')?.split(';')[0] !== 'video/mp4') {
      throw new Error('แอปยังไม่ได้รับไฟล์ MP4 ที่บันทึกได้')
    }
    const handle = existing ?? await directory.getFileHandle(filename, { create: true })
    await response.body.pipeTo(await handle.createWritable())
    const file = await handle.getFile()
    if (!file.size) throw new Error('ไฟล์วิดีโอที่บันทึกไว้ยังไม่มีข้อมูล')
    return file
  })
}

export function saveEpisodeSubtitles(projectId: string, episodeId: string) {
  return navigator.locks.request(`novel-subtitles:${projectId}:${episodeId}`, async () => {
    const { workspace, directory } = await openFootages(projectId)
    const response = await fetch(`/api/episodes/${encodeURIComponent(episodeId)}/subtitles`, { cache: 'no-store' })
    if (!response.ok) {
      const details = await response.json().catch(() => null)
      throw new Error(details?.error || 'เตรียมซับไตเติลไม่สำเร็จ กรุณาลองอีกครั้ง')
    }
    const { filename, text, cueCount }: { filename: string; text: string; cueCount: number } = await response.json()
    const handle = await directory.getFileHandle(filename, { create: true })
    await new Blob([text], { type: 'application/x-subrip;charset=utf-8' }).stream()
      .pipeTo(await handle.createWritable())
    return { path: `${workspace.folder.name}/Footages/${handle.name}`, cueCount, workspaceId: workspace.workspaceId }
  })
}
