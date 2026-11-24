import { useQuery } from '@tanstack/react-query'
import api from '../lib/api'

interface AppSettings {
  llmProvider: string
  llmModel: string
  llmKeySet: boolean
  rhBaseUrl: string
  rhKeySet: boolean
  rhKeyPreview: string
  dataDir: string
}

const aiProviderNames: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
}

export function aiProviderName(provider: string) {
  return aiProviderNames[provider] ?? provider
}

export function useAppSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<AppSettings>('/settings').then(response => response.data),
  })
}
