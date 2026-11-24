import { useMutation, useQuery } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import api from '../../lib/api'
import { aiProviderName, useAppSettings } from '../../hooks/useAppSettings'

interface HealthData {
  status: string
  mongo: string
  llmKey: string
  rhKey: string
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
}

export function SettingsPage() {
  const { data: health, isLoading: healthLoading, refetch } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then(r => r.data),
    refetchInterval: 30_000,
  })
  const { data: settings } = useAppSettings()
  const llmTest = useMutation({
    mutationFn: async () => {
      try {
        await api.post('/settings/llm/test')
      } catch (error) {
        const detail = isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined
        throw new Error(detail || 'ทดสอบการเชื่อมต่อ AI ไม่สำเร็จ')
      }
    },
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-8 space-y-6">
        <div className="flex items-center gap-3">
          <a href="/" className="text-blue-600 hover:underline text-sm">◀ กลับ</a>
          <h1 className="text-xl font-semibold">Settings & Health</h1>
        </div>

        {/* Health */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="font-medium">System Health</h2>
            <button onClick={() => refetch()} disabled={healthLoading}
              className="text-xs px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-40">
              {healthLoading ? '…' : '↻ refresh'}
            </button>
          </div>
          {health && (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <StatusDot ok={health.mongo === 'connected'} />
                <span>MongoDB: <span className="font-medium">{health.mongo}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot ok={health.llmKey === 'set'} />
                <span>LLM API Key: <span className="font-medium">{health.llmKey}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <StatusDot ok={health.rhKey === 'set'} />
                <span>RunningHub Key: <span className="font-medium">{health.rhKey}</span></span>
              </div>
            </div>
          )}
        </div>

        {/* Settings info */}
        {settings && (
          <div className="bg-white border rounded-xl p-5 space-y-3">
            <h2 className="font-medium">การตั้งค่าปัจจุบัน</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">AI ทุกโปรเจกต์</span>
                <span className="font-medium">{aiProviderName(settings.llmProvider)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">LLM Model</span>
                <span className="font-mono">{settings.llmModel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">LLM Key</span>
                <span>{settings.llmKeySet ? 'ตั้งค่าแล้ว' : '❌ ไม่ได้ตั้ง'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">RunningHub URL</span>
                <span className="font-mono text-xs">{settings.rhBaseUrl}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">RunningHub Key</span>
                <span className="font-mono">{settings.rhKeySet ? settings.rhKeyPreview : '❌ ไม่ได้ตั้ง'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Data Directory</span>
                <span className="font-mono text-xs">{settings.dataDir}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button type="button" onClick={() => llmTest.mutate()}
                disabled={!settings.llmKeySet || llmTest.isPending}
                className="rounded border px-2.5 py-1.5 hover:bg-gray-50 disabled:opacity-40">
                {llmTest.isPending ? 'กำลังทดสอบ…' : 'ทดสอบการเชื่อมต่อ AI'}
              </button>
              {llmTest.isSuccess && <span role="status" className="text-green-700">✔ เชื่อมต่อสำเร็จ</span>}
              {llmTest.isError && <span role="alert" className="text-red-700">{llmTest.error.message}</span>}
            </div>
            <p className="text-xs text-gray-400 pt-1">
              แก้ไขค่าได้ที่ไฟล์ <code>.env</code> แล้ว restart server
            </p>
          </div>
        )}

        {/* Backup */}
        <div className="bg-white border rounded-xl p-5 space-y-3">
          <h2 className="font-medium">Backup</h2>
          <p className="text-sm text-gray-500">รัน <code className="font-mono bg-gray-100 px-1 rounded">npm run backup</code> ใน terminal เพื่อสำรองข้อมูล MongoDB + assets</p>
        </div>
      </div>
    </div>
  )
}
