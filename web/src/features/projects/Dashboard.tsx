import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { episodesApi, projectsApi } from '../../lib/api'
import type { Episode, Project } from '../../lib/api'

const EP_STATUS_LABEL: Record<string, string> = {
  ingested: 'นำเข้าแล้ว',
  bible_review: 'รอตรวจ Bible',
  scenes_review: 'รอตรวจ Scenes',
  shots_review: 'รอตรวจ Shots',
  done: 'เสร็จแล้ว',
}
const EP_STATUS_COLOR: Record<string, string> = {
  ingested: 'bg-gray-100 text-gray-600',
  bible_review: 'bg-yellow-100 text-yellow-700',
  scenes_review: 'bg-blue-100 text-blue-700',
  shots_review: 'bg-purple-100 text-purple-700',
  done: 'bg-green-100 text-green-700',
}

function NewProjectModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const create = useMutation({
    mutationFn: () => projectsApi.create({ title }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); onClose() },
  })
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 w-96 space-y-4 shadow-xl">
        <h2 className="text-lg font-semibold">สร้างโปรเจกต์ใหม่</h2>
        <input
          autoFocus value={title} onChange={e => setTitle(e.target.value)}
          placeholder="ชื่อนิยาย / ชื่อโปรเจกต์"
          className="w-full border rounded px-3 py-2"
          onKeyDown={e => e.key === 'Enter' && title && create.mutate()}
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-gray-50">ยกเลิก</button>
          <button
            onClick={() => create.mutate()}
            disabled={!title || create.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
          >
            สร้าง
          </button>
        </div>
      </div>
    </div>
  )
}

function EpisodeRow({ ep, projectId }: { ep: Episode; projectId: string }) {
  const navigate = useNavigate()
  return (
    <div
      onClick={() => navigate(`/projects/${projectId}/ep/${ep._id}`)}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer border-b last:border-0"
    >
      <span className="text-sm font-medium w-16 shrink-0">EP{ep.number}</span>
      <span className="text-sm flex-1 truncate">{ep.title || `ตอนที่ ${ep.number}`}</span>
      <span className={`text-xs px-2 py-0.5 rounded ${EP_STATUS_COLOR[ep.status] ?? 'bg-gray-100 text-gray-600'}`}>
        {EP_STATUS_LABEL[ep.status] ?? ep.status}
      </span>
      <span className="text-xs text-gray-400">{ep.paragraphs?.length ?? 0} ย่อหน้า</span>
    </div>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const { data: episodes = [] } = useQuery({
    queryKey: ['episodes', project._id],
    queryFn: () => episodesApi.list(project._id),
  })

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      <div className="p-5 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-lg">{project.title}</h3>
            <p className="text-sm text-gray-500 mt-0.5">{episodes.length} ตอน</p>
          </div>
          <span className="text-xs text-gray-400">{new Date(project.createdAt).toLocaleDateString('th-TH')}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/projects/${project._id}/ep/new`)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            + เพิ่มตอน
          </button>
          {episodes.length > 0 && (
            <button
              onClick={() => navigate(`/projects/${project._id}/ep/${episodes[episodes.length - 1]._id}`)}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
            >
              เปิดตอนล่าสุด
            </button>
          )}
          {episodes.length > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50 ml-auto"
            >
              {expanded ? '▲ ซ่อน' : `▼ ดูทั้งหมด (${episodes.length})`}
            </button>
          )}
        </div>
      </div>

      {expanded && episodes.length > 0 && (
        <div className="border-t">
          {episodes.map(ep => <EpisodeRow key={ep._id} ep={ep} projectId={project._id} />)}
        </div>
      )}
    </div>
  )
}

export function Dashboard() {
  const [showNew, setShowNew] = useState(false)
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto p-8 space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">🎬 Novel to Anime</h1>
          <div className="flex gap-2">
            <a href="/settings" className="px-3 py-2 text-sm border rounded hover:bg-white">⚙ Settings</a>
            <button
              onClick={() => setShowNew(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              + โปรเจกต์ใหม่
            </button>
          </div>
        </div>

        {isLoading && <div className="text-gray-400">กำลังโหลด…</div>}

        {!isLoading && projects.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📖</div>
            <p>ยังไม่มีโปรเจกต์ กดปุ่ม "+ โปรเจกต์ใหม่" เพื่อเริ่ม</p>
          </div>
        )}

        <div className="space-y-4">
          {projects.map(p => <ProjectCard key={p._id} project={p} />)}
        </div>
      </div>

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} />}
    </div>
  )
}
