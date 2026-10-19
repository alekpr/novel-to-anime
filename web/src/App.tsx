import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom'
import { Dashboard } from './features/projects/Dashboard'
import { EpisodeWorkspace } from './features/episode/EpisodeWorkspace'
import { SettingsPage } from './features/settings/SettingsPage'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } })

function EpisodePage() {
  const { projectId = '', episodeId } = useParams<{ projectId: string; episodeId?: string }>()
  return <EpisodeWorkspace projectId={projectId} key={episodeId ?? 'new'} />
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects/:projectId/ep/:episodeId" element={<EpisodePage />} />
          <Route path="/projects/:projectId/ep/new" element={<EpisodePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
