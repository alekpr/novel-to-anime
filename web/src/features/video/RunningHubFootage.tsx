import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { EpisodeImageResources } from '../images/useImageResources'
import { episodeFootageFolder, saveFootage } from './footageStore'

function FootagePlayer({ file, clipCode }: { file: File; clipCode: string }) {
  const video = useRef<HTMLVideoElement>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const player = video.current
    if (!player) return
    const url = URL.createObjectURL(file.type === 'video/mp4' ? file : file.slice(0, file.size, 'video/mp4'))
    player.src = url
    return () => {
      player.removeAttribute('src')
      player.load()
      URL.revokeObjectURL(url)
    }
  }, [file])
  return (
    <>
      <video ref={video} controls playsInline preload="metadata" aria-label={`วิดีโอ ${clipCode}`}
        onError={() => setFailed(true)} onLoadedMetadata={() => setFailed(false)} hidden={failed}
        className="mx-auto max-h-[70dvh] w-full rounded-lg bg-slate-950" />
      {failed && <p role="alert" className="text-sm text-red-700">เปิดเล่นไฟล์ {file.name} จาก Footages ไม่สำเร็จ</p>}
    </>
  )
}

export function RunningHubFootage({ projectId, episodeNumber, sceneCode, clipCode, jobId, index, resources, visible, onImages }: {
  projectId: string; episodeNumber: number; sceneCode: string; clipCode: string; jobId: string; index: number;
  resources: EpisodeImageResources; visible: boolean; onImages: () => void;
}) {
  const ready = resources.footagesStatus === 'ready'
  const footage = useQuery({
    queryKey: ['footage', projectId, resources.workspaceId, episodeNumber, jobId, index],
    queryFn: () => saveFootage(projectId, episodeNumber, sceneCode, clipCode, jobId, index),
    enabled: ready,
    staleTime: Infinity,
    retry: false,
  })

  if (!visible) return null
  return (
    <div className="space-y-2 border-t border-slate-100 pt-2">
      {!ready && !resources.isLoading && (
        <div className="space-y-1 text-sm text-amber-800">
          <p>วิดีโอสร้างเสร็จแล้ว รอบันทึกลง Footages</p>
          {resources.folderName ? (
            <button type="button" disabled={!!resources.busy} onClick={() => void resources.enableFootages()} className="font-medium underline disabled:opacity-40">
              {resources.busy === 'footages' ? 'กำลังเปิดโฟลเดอร์…' : 'อนุญาตให้บันทึกใน Footages'}
            </button>
          ) : (
            <button type="button" onClick={onImages} className="font-medium underline">เลือกโฟลเดอร์ที่ขั้น 5</button>
          )}
          {resources.error?.target === 'footages' && <p role="alert">{resources.error.message}</p>}
        </div>
      )}
      {ready && footage.isFetching && !footage.data && <p role="status" className="text-sm text-blue-700">กำลังบันทึกวิดีโอลง Footages…</p>}
      {footage.isError && (
        <p role="alert" className="text-sm text-red-700">
          {footage.error.message}{' '}
          {ready && <button type="button" onClick={() => void footage.refetch()} className="font-medium underline">ลองบันทึกอีกครั้ง</button>}
        </p>
      )}
      {footage.data && (
        <>
          <p className="break-words text-xs font-medium text-green-700">บันทึกแล้ว · Footages/{episodeFootageFolder(episodeNumber)}/{footage.data.name}</p>
          <FootagePlayer file={footage.data} clipCode={clipCode} />
        </>
      )}
    </div>
  )
}
