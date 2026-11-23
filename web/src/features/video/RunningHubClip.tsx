import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Clip, Scene } from '../../lib/api'
import { characterImageKey, locationImageKey, outfitImageKeys } from '../../../../src/utils/imageReferenceKeys'
import { supportedReferenceImage, validPictureSlots, videoDuration, videoRatio } from '../../../../src/utils/videoClipInputs'
import { isDramaClipDuration } from '../../../../src/utils/shortDrama'
import { inspectImageWorkspace } from '../images/imageResourceStore'
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
  const slots = imageSlots(clip, resources)
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
  const disabled = !configured || !validSlots || !validClip || resources.isLoading ||
    needed.length > 0 || unsupported.length > 0 || pending || send.isPending || jobQuery.isLoading

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
      {job?.videos.map((_, i) => (
        <RunningHubFootage key={`${job.id}:${i}`} projectId={projectId} sceneCode={scene.sceneCode}
          clipCode={clip.clipCode} jobId={job.id} index={i + 1} resources={resources} visible={visible} onImages={onImages} />
      ))}
    </section>
  )
}
