import { aiProviderName, useAppSettings } from '../hooks/useAppSettings'

export function AiProviderBadge() {
  const { data, isError } = useAppSettings()
  if (!data?.llmProvider && !isError) return null

  return (
    <span title={data?.llmModel}
      className="shrink-0 whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
      AI · {data?.llmProvider ? aiProviderName(data.llmProvider) : 'โหลดชื่อผู้ให้บริการไม่ได้'}
    </span>
  )
}
