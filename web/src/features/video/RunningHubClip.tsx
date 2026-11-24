import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { promptsApi } from '../../lib/api'
import type { Clip, Scene } from '../../lib/api'
import { characterImageKey, locationImageKey, outfitImageKeys } from '../../../../src/utils/imageReferenceKeys'
import { supportedReferenceImage, validPictureSlots, videoDuration, videoRatio } from '../../../../src/utils/videoClipInputs'
import { isDramaClipDuration } from '../../../../src/utils/shortDrama'
import { usesLatinVideoPrompt } from '../../../../src/utils/videoPromptLanguage'
import { inspectImageWorkspace } from '../images/imageResourceStore'
import { referenceUpdateKey } from '../images/updateReferencePrompt'
import type { EpisodeImageResources } from '../images/useImageResources'
import { runningHubApi, runningHubCountsKey, runningHubMessage } from './runningHubApi'
import type { RunningHubSettings } from './runningHubApi'
import { RunningHubFootage } from './RunningHubFootage'

function imageSlots(clip: Clip, resources: EpisodeImageResources) {
  const names = new Map<string, string[]>()
  function add(role: string, name: string, key: string) {
    const id = JSON.stringify([role, name])
    names.set(id, [...(names.get(id) ?? []), key])
  }
  for (const char of resources.chars) {
    const outfits = char.outfits ?? []
    if (!outfits.length) add('character', char.name, characterImageKey(char._id))
    const keys = outfitImageKeys(char)
    outfits.forEach((outfit, i) => add('character', outfit.name ? `${char.name} · ${outfit.name}` : char.name, keys[i]))
  }
  for (const loc of resources.locs) add('location', loc.name, locationImageKey(loc._id))

  return (clip.referenceSlots ?? []).slice().sort((a, b) => a.index - b.index).map(slot => {
    const matches = names.get(JSON.stringify([slot.role, slot.name]))
    return { ...slot, key: slot.resourceKey ?? (matches?.length === 1 ? matches[0] : undefined) }
  })
}

export function RunningHubClip({ projectId, scene, clip, settings, resources, visible, onSetup, onImages }: {
  projectId: string; scene: Scene; clip: Clip; settings?: RunningHubSettings; resources: EpisodeImageResources
  visible: boolean
  onSetup: () => void; onImages: () => void
}) {
  const qc = useQueryClient()
  const commentId = useId()
  const [comment, setComment] = useState('')
  const promptVersion = clip.promptVersion ?? 1
  const jobKey = ['runninghub-job', scene._id, clip.clipCode, clip.promptVersion]
  const jobQuery = useQuery({
    queryKey: jobKey,
    queryFn: () => runningHubApi.getJob(scene._id, clip.clipCode),
    refetchOnMount: 'always',
    refetchInterval: query => {
      const status = query.state.data?.job?.status
      return status === 'queued' || status === 'running' ? 4000 : false
    },
  })
  const job = jobQuery.data?.job
  const pending = job?.status === 'queued' || job?.status === 'running'
  const currentVideo = job?.status === 'succeeded' && job.videos.length > 0 ? job : undefined
  const previousVideo = !currentVideo ? clip.promptRevision : undefined
  const videoJobId = currentVideo?.id ?? previousVideo?.sourceJobId
  const videoCount = currentVideo?.videos.length ?? previousVideo?.sourceVideoCount ?? 0
  const slots = imageSlots(clip, resources)
  const updatingKeys = useMutationState({
    filters: { mutationKey: referenceUpdateKey(projectId), status: 'pending' },
    select: mutation => mutation.options.mutationKey?.[2],
  })
  const updatingPrompt = slots.some(slot => slot.key && updatingKeys.includes(slot.key))
  const needed = slots.filter(slot => !slot.key || resources.references[slot.key]?.status !== 'ready')
  const unsupported = slots.filter(slot => {
    const ref = slot.key ? resources.references[slot.key] : undefined
    return ref?.status === 'ready' && !supportedReferenceImage(ref.file.name, ref.file.size)
  })
  const ratio = videoRatio(clip.videoPrompt) ?? (scene.dramaBeat ? '9:16' : undefined)
  const validSlots = validPictureSlots(clip.videoPrompt, slots)
  const duration = videoDuration(clip.videoPrompt) ?? clip.durationSec
  const validDuration = duration === clip.durationSec &&
    (scene.dramaBeat ? isDramaClipDuration(duration) : Number.isFinite(duration) && duration > 0)
  const validClip = !!ratio && validDuration && !!clip.videoPrompt.trim()
  const validLanguage = usesLatinVideoPrompt(clip.videoPrompt)
  const configured = !!settings?.keySet && !!settings.workflowId

  const send = useMutation({
    mutationFn: async () => {
      const keys = slots.flatMap(slot => slot.key ? [slot.key] : [])
      const current = await inspectImageWorkspace(projectId, keys)
      const body = new FormData()
      body.append('promptVersion', String(clip.promptVersion))
      for (const slot of slots) {
        const ref = slot.key ? current.references[slot.key] : undefined
        if (ref?.status !== 'ready' || !supportedReferenceImage(ref.file.name, ref.file.size)) {
          throw new Error(`ตรวจไฟล์ Picture ${slot.index} · ${slot.name} ในขั้น 5 ก่อนส่ง`)
        }
        body.append(`picture-${slot.index}`, ref.file)
      }
      return runningHubApi.send(scene._id, clip.clipCode, body)
    },
    onSuccess: async result => {
      await qc.cancelQueries({ queryKey: jobKey })
      qc.setQueryData(jobKey, result)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['image-workspace', projectId] })
      void qc.invalidateQueries({ queryKey: runningHubCountsKey(scene.episodeId) })
    },
    onError: () => { void qc.invalidateQueries({ queryKey: jobKey }) },
  })
  const sceneClipsKey = ['scene-clips', scene._id]
  const episodeScenesKey = ['scenes', scene.episodeId]
  const refreshPrompts = () => Promise.all([
    qc.invalidateQueries({ queryKey: sceneClipsKey }),
    qc.invalidateQueries({ queryKey: episodeScenesKey }),
  ])
  const revise = useMutation({
    mutationKey: ['video-prompt-revision', scene.episodeId],
    mutationFn: (sourceJobId: string) => promptsApi.reviseClip(scene._id, clip.clipCode, {
      comment: comment.trim(), promptVersion, sourceJobId,
    }),
    onSuccess: async updated => {
      await Promise.all([
        qc.cancelQueries({ queryKey: sceneClipsKey }),
        qc.cancelQueries({ queryKey: episodeScenesKey }),
      ])
      const updateClips = (clips: Clip[]) => clips.map(item =>
        item.clipCode === clip.clipCode && (item.promptVersion ?? 1) === promptVersion && !item.stale
          ? { ...item, ...updated } : item,
      )
      qc.setQueryData<{ clips: Clip[] }>(sceneClipsKey, old => old && { ...old, clips: updateClips(old.clips) })
      qc.setQueryData<Scene[]>(episodeScenesKey, old => old?.map(item =>
        item._id === scene._id && item.clips ? { ...item, clips: updateClips(item.clips) } : item,
      ))
      setComment('')
      await refreshPrompts()
    },
    onError: () => { void refreshPrompts() },
  })
  const disabled = !configured || !validSlots || !validClip || !validLanguage || resources.isLoading ||
    needed.length > 0 || unsupported.length > 0 || pending || send.isPending || jobQuery.isLoading || updatingPrompt || revise.isPending
  const canRevise = !!videoJobId && !!comment.trim() && !pending && !send.isPending && !updatingPrompt && !revise.isPending

  return (
    <section aria-label={`RunningHub ${clip.clipCode}`} className="space-y-3 rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">RunningHub</span>
        <button type="button" disabled={disabled} onClick={() => send.mutate()}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40">
          {send.isPending ? 'กำลังส่งภาพและพรอมป์…' : 'Create Video'}
        </button>
      </div>
      <p className="text-xs text-slate-600">
        {ratio ?? 'ยังไม่พบสัดส่วนภาพ'} · {duration} วินาที · ภาพพร้อม {slots.length - needed.length - unsupported.length}/{slots.length}
      </p>
      {settings && !configured && <button type="button" onClick={onSetup} className="text-sm text-blue-700 underline">ตั้งค่า API Key และ Workflow ก่อนส่ง</button>}
      {(!validSlots || !validClip) && <p className="text-sm text-amber-800">ตรวจสัดส่วน เวลา และลำดับ Picture ในพรอมป์ที่สร้างในขั้น 6</p>}
      {!validLanguage && <p className="text-sm text-amber-800">
        พรอมป์นี้ยังมีข้อความนอกบทพูดที่เป็นภาษาอื่น กรุณาสร้างพรอมป์ใหม่ในขั้น 6{videoJobId ? ' หรือส่งคอมเมนต์ให้ AI ปรับพรอมป์ด้านล่าง' : ''}
      </p>}
      {needed.length > 0 && !resources.isLoading && (
        <p className="text-sm text-amber-800">
          รอภาพ {needed.map(slot => `Picture ${slot.index} · ${slot.name}`).join(', ')}{' '}
          <button type="button" onClick={onImages} className="font-medium underline">เปิดขั้น 5</button>
        </p>
      )}
      {unsupported.length > 0 && <p className="text-sm text-amber-800">
        Picture {unsupported.map(slot => slot.index).join(', ')} ต้องเป็น PNG, JPG หรือ WebP ขนาดไม่เกิน 10 MB ต่อภาพ
      </p>}
      {jobQuery.isError && <p role="alert" className="text-sm text-red-700">{runningHubMessage(jobQuery.error, 'โหลดสถานะวิดีโอไม่สำเร็จ')}</p>}
      {send.isError && <p role="alert" className="text-sm text-red-700">{runningHubMessage(send.error, 'ส่งวิดีโอไม่สำเร็จ')}</p>}
      {pending && <p role="status" className="text-sm text-blue-700">
        {job.status === 'queued' ? 'รอคิว RunningHub' : 'RunningHub กำลังสร้างวิดีโอ'}{job.taskId && ` · ${job.taskId}`}
      </p>}
      {job?.notice && <p className="text-sm text-amber-800">{job.notice}</p>}
      {job?.error && !send.isError && <p role="alert" className="text-sm text-red-700">{job.error}{job.taskId && ` · ${job.taskId}`}</p>}
      {previousVideo && (
        <p className="text-xs font-medium text-slate-600">
          วิดีโอจากพรอมป์เวอร์ชันก่อน{previousVideo.sourcePromptVersion && ` · v${previousVideo.sourcePromptVersion}`}
        </p>
      )}
      {videoJobId && Array.from({ length: videoCount }, (_, i) => (
        <RunningHubFootage key={`${videoJobId}:${i}`} projectId={projectId} sceneCode={scene.sceneCode}
          clipCode={clip.clipCode} jobId={videoJobId} index={i + 1} resources={resources} visible={visible} onImages={onImages} />
      ))}
      {videoJobId && (
        <form className="space-y-2 border-t pt-3" onSubmit={event => {
          event.preventDefault()
          if (canRevise) revise.mutate(videoJobId)
        }}>
          <label htmlFor={commentId} className="block text-sm font-medium">คอมเมนต์เพื่อปรับพรอมป์</label>
          <textarea id={commentId} value={comment} maxLength={2000} rows={3} disabled={revise.isPending}
            onChange={event => setComment(event.target.value)}
            placeholder="เช่น ให้ตัวละครพูดเบาลง แล้วตัดเข้าภาพใกล้ตอนอีกคนชะงัก"
            className="w-full resize-y rounded-lg border px-3 py-2 text-sm disabled:opacity-50" />
          <button type="submit" disabled={!canRevise}
            className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-40">
            {revise.isPending ? 'กำลังปรับพรอมป์…' : 'ส่งให้ AI ปรับพรอมป์'}
          </button>
          {revise.isPending && <p role="status" className="text-sm text-violet-800">AI กำลังปรับ Video Prompt จากคอมเมนต์…</p>}
          {revise.isError && <p role="alert" className="text-sm text-red-700">{runningHubMessage(revise.error, 'ปรับพรอมป์จากคอมเมนต์ไม่สำเร็จ')}</p>}
        </form>
      )}
    </section>
  )
}
