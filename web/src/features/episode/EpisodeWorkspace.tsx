import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { EpisodeStepper } from '../../components/EpisodeStepper'
import { NextActionBar } from '../../components/NextActionBar'
import { ClipsStep } from '../clips/ClipsStep'
import { ExportStep } from '../export/ExportStep'
import { ImagePromptsStep } from '../images/ImagePromptsStep'
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
  bible:   'ให้ AI วิเคราะห์ แล้วอนุมัติตัวละครและสถานที่ทั้งหมด',
  scenes:  'ตรวจ scenes แล้วกด "ไปขั้น Shots"',
  shots:   'ตรวจบทพูดที่ AI แต่งเพิ่ม แล้วไปขั้นถัดไป',
  images:  'copy prompt ไปสร้างภาพ character sheet / location ด้วยโปรแกรมที่ต้องการ',
  clips:   'กด "สร้าง Prompt" ต่อ scene เพื่อสร้าง DY prompt และแบ่ง clips',
  video:   'copy DY prompt ต่อ clip ไปสร้างวิดีโอด้วยโปรแกรมที่ต้องการ',
  export:  'ตรวจ QA แล้ว export ไฟล์',
}

interface Props { projectId: string }

export function EpisodeWorkspace({ projectId }: Props) {
  const { episodeId: paramEpId } = useParams<{ episodeId?: string }>()
  const qc = useQueryClient()
  const [episodeId, setEpisodeId] = useState<string | null>(paramEpId ?? null)
  const [step, setStep] = useState<StepKey>(episodeId ? 'bible' : 'import')
  const [selectedSceneId, setSelectedSceneId] = useState<string | undefined>()
  const [autoStepped, setAutoStepped] = useState(false)

  // reset autoStepped เมื่อ episodeId เปลี่ยน
  useEffect(() => {
    setAutoStepped(false)
    setStep(episodeId ? 'bible' : 'import')
  }, [episodeId])

  const { data: episode } = useQuery({
    queryKey: ['episode', episodeId],
    queryFn: () => episodesApi.get(episodeId!),
    enabled: !!episodeId,
  })

  const { data: statusData } = useEpisodeStatus(episodeId)

  // auto-detect ขั้นที่เหมาะสมเมื่อเปิด episode ที่มีอยู่แล้ว (ทำครั้งเดียว)
  useEffect(() => {
    if (!statusData || autoStepped || !episodeId) return
    const firstNonApproved = statusData.steps.find(s => s.status !== 'approved')
    if (firstNonApproved) {
      const key = firstNonApproved.key as StepKey
      if (STEPS.some(s => s.key === key)) setStep(key)
    }
    setAutoStepped(true)
    // invalidate episode-status ทุกครั้งที่ episodeId เปลี่ยน
    qc.invalidateQueries({ queryKey: ['episode-status', episodeId] })
  }, [statusData, autoStepped, episodeId, qc])

  // ใช้สถานะจาก backend เสมอ ถ้ายังไม่โหลดให้ทุก step เป็น locked ก่อน
  const stepStatuses: StepStatus[] = STEPS.map((s) => {
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

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-white border-b">
        <a href="/" className="text-blue-600 hover:underline text-sm">◀ โปรเจกต์</a>
        <span className="text-gray-400">/</span>
        <span className="font-medium text-sm">
          {episode ? `EP${episode.number} – ${episode.title}` : 'Episode'}
        </span>
        <a href="/settings" className="ml-auto text-xs text-gray-400 hover:text-gray-600">⚙ Settings</a>
      </div>

      {/* Stepper */}
      <EpisodeStepper
        steps={STEPS.map((s, i) => ({ label: s.label, status: stepStatuses[i] }))}
        current={currentIdx}
        onSelect={(i) => setStep(STEPS[i].key)}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {step === 'import' && (
          <ImportStep projectId={projectId} onDone={(id) => { setEpisodeId(id); setStep('bible') }} />
        )}
        {step === 'bible' && episodeId && (
          <BibleStep projectId={projectId} episodeId={episodeId} onDone={goNext} />
        )}
        {step === 'scenes' && episodeId && (
          <ScenesStep
            episodeId={episodeId}
            onSelectScene={(id) => { setSelectedSceneId(id); setStep('shots') }}
            onDone={goNext}
          />
        )}
        {step === 'shots' && episodeId && (
          <ShotsStep episodeId={episodeId} initialSceneId={selectedSceneId} />
        )}
        {step === 'images' && episodeId && (
          <ImagePromptsStep projectId={projectId} episodeId={episodeId} />
        )}
        {step === 'clips' && episodeId && (
          <ClipsStep episodeId={episodeId} />
        )}
        {step === 'video' && episodeId && (
          <VideoPromptsStep episodeId={episodeId} />
        )}
        {step === 'export' && episodeId && (
          <ExportStep episodeId={episodeId} />
        )}
      </div>

      {/* Next action bar */}
      <NextActionBar
        message={NEXT_MSG[step]}
        onBack={!isFirst ? goBack : undefined}
        onNext={!isLast && step !== 'import' ? goNext : undefined}
      />
    </div>
  )
}
