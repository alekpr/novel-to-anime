import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { EpisodeStepper } from '../../components/EpisodeStepper'
import { AiProviderBadge } from '../../components/AiProviderBadge'
import { NextActionBar } from '../../components/NextActionBar'
import { ClipsStep } from '../clips/ClipsStep'
import { ExportStep } from '../export/ExportStep'
import { ImagePromptsStep } from '../images/ImagePromptsStep'
import { useImageResources } from '../images/useImageResources'
import { ImportStep } from '../import/ImportStep'
import { BibleStep } from '../bible/BibleStep'
import { ScenesStep } from '../scenes/ScenesStep'
import { ShotsStep } from '../shots/ShotsStep'
import { VideoPromptsStep } from '../video/VideoPromptsStep'
import { useEpisodeStatus } from '../../hooks/useEpisodeStatus'
import { episodesApi } from '../../lib/api'
import type { StepStatus } from '../../hooks/useEpisodeStatus'

type StepKey = 'import' | 'bible' | 'scenes' | 'shots' | 'images' | 'clips' | 'video' | 'export'

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'import',  label: 'นำเข้า' },
  { key: 'bible',   label: 'Bible' },
  { key: 'scenes',  label: 'Scenes' },
  { key: 'shots',   label: 'Shots' },
  { key: 'images',  label: 'ภาพ Prompt' },
  { key: 'clips',   label: 'Clips' },
  { key: 'video',   label: 'Video Prompt' },
  { key: 'export',  label: 'Export' },
]

const NEXT_MSG: Record<StepKey, string> = {
  import:  'วางข้อความนิยายแล้วกด "บันทึก"',
  bible:   'ตรวจและอนุมัติตัวละครกับสถานที่ที่ใช้ในตอนนี้',
  scenes:  'ตรวจ scenes แล้วกด "ไปขั้น Shots"',
  shots:   'ตรวจมุมกล้อง การแสดง และบทพูด แล้วกดอนุมัติ All ของแต่ละซีน',
  images:  'เชื่อมไฟล์ภาพอ้างอิงของตัวละคร ชุด และสถานที่ที่ท้ายพรอมป์',
  clips:   'สร้างพรอมป์รายคลิปหรือทั้งตอน',
  video:   'เชื่อมภาพจากขั้น 5 แล้วส่งสร้างวิดีโอทีละคลิปใน RunningHub',
  export:  'ตรวจ QA แล้ว export ไฟล์',
}

interface Props { projectId: string }

export function EpisodeWorkspace({ projectId }: Props) {
  const { episodeId: paramEpId } = useParams<{ episodeId?: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const reviewSource = searchParams.get('review') === '1'
  const qc = useQueryClient()
  const [episodeId, setEpisodeId] = useState<string | null>(paramEpId ?? null)
  const [step, setStep] = useState<StepKey>(episodeId && !reviewSource ? 'bible' : 'import')
  const [selectedSceneId, setSelectedSceneId] = useState<string | undefined>()
  const [autoStepped, setAutoStepped] = useState(false)

  // reset autoStepped เมื่อ episodeId เปลี่ยน
  useEffect(() => {
    setAutoStepped(false)
    setStep(episodeId && !reviewSource ? 'bible' : 'import')
  }, [episodeId, reviewSource])

  const { data: episode, isError: episodeLoadFailed } = useQuery({
    queryKey: ['episode', episodeId],
    queryFn: () => episodesApi.get(episodeId!),
    enabled: !!episodeId,
  })

  const { data: statusData, isError: statusLoadFailed } = useEpisodeStatus(episodeId)
  const imagesStep = statusData?.steps.find(item => item.key === 'images')
  const imageResources = useImageResources(projectId, statusData?.bible,
    !!episodeId && (step === 'images' || (!!imagesStep && imagesStep.status !== 'locked')),
  )
  const imagesStatus: StepStatus = !imagesStep || imagesStep.status === 'locked' ? 'locked'
    : imageResources.complete ? 'approved'
    : imageResources.missing > 0 ? 'stale'
    : imageResources.folderName ? 'needs_review' : imagesStep.status

  // auto-detect ขั้นที่เหมาะสมเมื่อเปิด episode ที่มีอยู่แล้ว (ทำครั้งเดียว)
  useEffect(() => {
    if (!statusData || autoStepped || !episodeId) return
    const firstNonApproved = !reviewSource && statusData.steps.find(s =>
      (s.key === 'images' ? imagesStatus : s.status) !== 'approved',
    )
    if (firstNonApproved && firstNonApproved.key === 'images' && imageResources.isLoading) return
    if (firstNonApproved) {
      const key = firstNonApproved.key as StepKey
      if (STEPS.some(s => s.key === key)) setStep(key)
    }
    setAutoStepped(true)
    // invalidate episode-status ทุกครั้งที่ episodeId เปลี่ยน
    qc.invalidateQueries({ queryKey: ['episode-status', episodeId] })
  }, [statusData, autoStepped, episodeId, reviewSource, imagesStatus, imageResources.isLoading, qc])

  const stepStatuses: StepStatus[] = STEPS.map((s) => {
    if (s.key === 'images') return imagesStatus
    if (statusData) {
      const found = statusData.steps.find(st => st.key === s.key)
      if (found) return found.status as StepStatus
    }
    return 'locked'
  })

  function goNext() {
    const idx = STEPS.findIndex(s => s.key === step)
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key)
  }
  function goBack() {
    const idx = STEPS.findIndex(s => s.key === step)
    if (idx > 0) setStep(STEPS[idx - 1].key)
  }

  const currentIdx = STEPS.findIndex(s => s.key === step)
  const isFirst = currentIdx === 0
  const isLast = currentIdx === STEPS.length - 1
  const scenesCanContinue = step !== 'scenes' || stepStatuses[currentIdx + 1] !== 'locked'
  const bibleCanContinue = step !== 'bible' || stepStatuses[currentIdx] === 'approved'

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-white px-4 py-2">
        <a href="/" className="text-blue-600 hover:underline text-sm">◀ โปรเจกต์</a>
        <span className="text-gray-400">/</span>
        <span className="font-medium text-sm">
          {episode ? `EP${episode.number} – ${episode.title}` : 'Episode'}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <AiProviderBadge />
          <a href="/settings" className="text-xs text-gray-400 hover:text-gray-600">⚙ Settings</a>
        </div>
      </div>

      {/* Stepper */}
      <EpisodeStepper
        steps={STEPS.map((s, i) => ({ label: s.label, status: stepStatuses[i] }))}
        current={currentIdx}
        onSelect={(i) => setStep(STEPS[i].key)}
      />
      {step !== 'images' && imageResources.missing > 0 && (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          หาไฟล์ภาพอ้างอิงของตอนนี้ไม่เจอ {imageResources.missing} รายการ
          <button type="button" onClick={() => setStep('images')} className="font-medium underline">ดูภาพอ้างอิง</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {step === 'import' && (episodeId && !episode ? (
          <p className="p-6 text-sm text-gray-600">{episodeLoadFailed ? 'โหลดเนื้อหาตอนไม่สำเร็จ' : 'กำลังโหลดเนื้อหาตอน…'}</p>
        ) : (
          <ImportStep key={episodeId ?? 'new'} projectId={projectId} initialEpisode={episode}
            onDone={id => {
              setEpisodeId(id)
              setStep('bible')
              void qc.invalidateQueries({ queryKey: ['episode', id] })
              void qc.invalidateQueries({ queryKey: ['episode-status', id] })
              void qc.invalidateQueries({ queryKey: ['episodes', projectId] })
              if (reviewSource) setSearchParams({}, { replace: true })
            }} />
        ))}
        {step === 'bible' && episodeId && (
          <BibleStep projectId={projectId} episodeId={episodeId} statusData={statusData}
            statusLoadFailed={statusLoadFailed} onDone={goNext} />
        )}
        {step === 'scenes' && episodeId && (
          <ScenesStep
            episodeId={episodeId}
            key={episodeId}
            savedTargetDurationSec={episode?.targetDurationSec}
            onSelectScene={(id) => { setSelectedSceneId(id); setStep('shots') }}
            onDone={goNext}
          />
        )}
        {step === 'shots' && episodeId && (
          <ShotsStep episodeId={episodeId} initialSceneId={selectedSceneId} />
        )}
        {step === 'images' && episodeId && (
          <ImagePromptsStep projectId={projectId} currentEp={episode?.number ?? 0} resources={imageResources} />
        )}
        {step === 'clips' && episodeId && (
          <ClipsStep episodeId={episodeId} />
        )}
        {episodeId && (step === 'video' || statusData?.steps.some(item => item.key === 'video' && item.status !== 'locked')) && (
          <div hidden={step !== 'video'}>
            <VideoPromptsStep key={episodeId} episodeId={episodeId} />
          </div>
        )}
        {step === 'export' && episodeId && (
          <ExportStep episodeId={episodeId} />
        )}
      </div>

      {/* Next action bar */}
      <NextActionBar
        message={NEXT_MSG[step]}
        onBack={!isFirst ? goBack : undefined}
        onNext={!isLast && step !== 'import' && scenesCanContinue ? goNext : undefined}
        nextDisabled={!bibleCanContinue}
      />
    </div>
  )
}
