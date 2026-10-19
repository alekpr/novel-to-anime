import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'

interface HealthData {
  status: string
  mongo: string
  llmKey: string
  rhKey: string
}

interface SettingsData {
  llmModel: string
  llmKeySet: boolean
  llmKeyPreview: string
  rhBaseUrl: string
  rhKeySet: boolean
  rhKeyPreview: string
  dataDir: string
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
  const { data: settings } = useQuery<SettingsData>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(r => r.data),
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
                <span className="text-gray-500">LLM Model</span>
                <span className="font-mono">{settings.llmModel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">LLM Key</span>
                <span className="font-mono">{settings.llmKeySet ? settings.llmKeyPreview : '❌ ไม่ได้ตั้ง'}</span>
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
