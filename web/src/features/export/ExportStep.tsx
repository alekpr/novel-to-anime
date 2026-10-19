import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import api from '../../lib/api'

interface Props { episodeId: string }

interface QAIssue {
  severity: 'error' | 'warning' | 'info'
  code: string
  message: string
  ref?: { type: string; id: string; code?: string }
}

interface QAReport {
  passed: boolean
  issues: QAIssue[]
  passedChecks: number
  totalChecks: number
  summary: { errors: number; warnings: number; info: number }
}

const severityStyle: Record<string, string> = {
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
}
const severityIcon: Record<string, string> = { error: '✖', warning: '⚠', info: 'ℹ' }

export function ExportStep({ episodeId }: Props) {
  const [format, setFormat] = useState<'json' | 'md' | 'csv'>('md')

  const { data: qa, isFetching: qaLoading, refetch: refetchQA } = useQuery<QAReport>({
    queryKey: ['qa', episodeId],
    queryFn: () => api.get(`/episodes/${episodeId}/qa`).then(r => r.data),
    enabled: false,
  })

  const doExport = useMutation({
    mutationFn: async () => {
      const a = document.createElement('a')
      a.href = `/api/episodes/${episodeId}/export?format=${format}`
      a.click()
    },
  })

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <h2 className="text-xl font-semibold">ขั้น 8 – Export</h2>

      {/* QA */}
      <div className="border rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-medium">QA Report</h3>
          <button
            onClick={() => refetchQA()}
            disabled={qaLoading}
            className="text-sm px-3 py-1.5 border rounded hover:bg-gray-50 disabled:opacity-40"
          >
            {qaLoading ? '⏳ กำลังตรวจ…' : '🔍 ตรวจสอบ'}
          </button>
        </div>

        {qa && (
          <>
            <div className="flex gap-4 text-sm items-center">
              <span className={`font-medium ${qa.summary.errors > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                ✖ {qa.summary.errors} errors
              </span>
              <span className={`font-medium ${qa.summary.warnings > 0 ? 'text-yellow-600' : 'text-gray-400'}`}>
                ⚠ {qa.summary.warnings} warnings
              </span>
              <span className="text-xs text-gray-400">
                ผ่าน {qa.passedChecks}/{qa.totalChecks} checks
              </span>
              {qa.passed && <span className="text-green-600 font-medium ml-auto">✔ ผ่านทั้งหมด</span>}
            </div>

            {qa.issues.length > 0 && (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {qa.issues.map((issue, i) => (
                  <div key={i} className={`border rounded p-2 text-sm ${severityStyle[issue.severity] ?? severityStyle.info}`}>
                    <span className="mr-1">{severityIcon[issue.severity] ?? 'ℹ'}</span>
                    {issue.ref?.code && (
                      <span className="font-mono text-xs bg-white/60 px-1 rounded mr-1">[{issue.ref.code}]</span>
                    )}
                    <span className="text-xs text-gray-500 mr-1">{issue.code}</span>
                    {issue.message}
                  </div>
                ))}
              </div>
            )}

            {qa.issues.length === 0 && (
              <div className="text-sm text-green-700 bg-green-50 rounded p-3">✔ ไม่พบปัญหา</div>
            )}
          </>
        )}

        {!qa && !qaLoading && (
          <div className="text-sm text-gray-400">กดปุ่ม "ตรวจสอบ" เพื่อรัน QA</div>
        )}
      </div>

      {/* Export */}
      <div className="border rounded-lg p-4 space-y-4">
        <h3 className="font-medium">Export ไฟล์</h3>
        <div className="flex gap-4">
          {(['json', 'md', 'csv'] as const).map(f => (
            <label key={f} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="format" value={f} checked={format === f} onChange={() => setFormat(f)} />
              <span className="text-sm font-mono">.{f}</span>
              <span className="text-xs text-gray-400">
                {f === 'json' ? '(ข้อมูลครบ)' : f === 'md' ? '(อ่านง่าย)' : '(shot list)'}
              </span>
            </label>
          ))}
        </div>

        <button
          onClick={() => doExport.mutate()}
          disabled={doExport.isPending}
          className="px-5 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40"
        >
          {doExport.isPending ? '⏳ กำลัง export…' : `⬇ Export .${format}`}
        </button>

        {doExport.isError && (
          <div className="text-sm text-red-600 bg-red-50 rounded p-3">
            ✖ {String((doExport.error as any)?.response?.data?.message ?? doExport.error)}
          </div>
        )}
      </div>
    </div>
  )
}
