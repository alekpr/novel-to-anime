import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { episodesApi, projectsApi } from '../../lib/api'
import type { Episode, Job, Project, Scene } from '../../lib/api'
import { NewProjectDialog } from './NewProjectDialog'
import { RenameProjectDialog } from './RenameProjectDialog'
import { deleteImageWorkspace } from '../images/imageResourceStore'

const EP_STATUS_LABEL: Record<string, string> = {
  ingested: 'นำเข้าแล้ว',
  bible_review: 'รอตรวจ Bible',
  scenes_review: 'รอตรวจ Scenes',
  scenes_pending: 'รอแบ่งซีน',
  scenes_replan: 'ต้องแบ่งซีนใหม่',
  shots_pending: 'รอสร้าง Shots',
  shots_review: 'รอตรวจ Shots',
  prompts_pending: 'พร้อมสร้างพรอมป์วิดีโอ',
  prompts_ready: 'พรอมป์วิดีโอพร้อมใช้',
  done: 'เสร็จแล้ว',
}
const EP_STATUS_COLOR: Record<string, string> = {
  ingested: 'bg-gray-100 text-gray-600',
  bible_review: 'bg-yellow-100 text-yellow-700',
  scenes_review: 'bg-blue-100 text-blue-700',
  scenes_pending: 'bg-blue-100 text-blue-700',
  scenes_replan: 'bg-orange-100 text-orange-800',
  shots_pending: 'bg-blue-100 text-blue-700',
  shots_review: 'bg-purple-100 text-purple-700',
  prompts_pending: 'bg-indigo-100 text-indigo-700',
  prompts_ready: 'bg-green-100 text-green-700',
  done: 'bg-green-100 text-green-700',
}

function ProjectMark({ small = false }: { small?: boolean }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-xl ${small ? 'size-9 bg-indigo-600 text-white' : 'size-12 bg-indigo-50 text-indigo-700'}`}>
      <span className="relative grid h-4 w-5 grid-cols-3 items-center gap-0.5 rounded-[3px] border-[1.5px] border-current px-0.5 before:absolute before:inset-x-0 before:top-[3px] before:border-t before:border-current">
        <span className="h-1 rounded-[1px] bg-current" />
        <span className="h-1 rounded-[1px] bg-current" />
        <span className="h-1 rounded-[1px] bg-current" />
      </span>
    </span>
  )
}

function DeleteProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const deleteProject = useMutation({
    mutationFn: () => projectsApi.delete(project._id),
    onSuccess: async () => {
      try {
        await deleteImageWorkspace(project._id)
      } catch (error) {
        console.warn('Could not remove local image references for the deleted project', error)
      }
      qc.removeQueries({ queryKey: ['image-workspace', project._id] })
      await qc.cancelQueries({ queryKey: ['projects'], exact: true })
      const cachedEpisodes = qc.getQueryData<Episode[]>(['episodes', project._id]) ?? []
      const episodeIds = new Set(cachedEpisodes.map(episode => episode._id))
      for (const [, episode] of qc.getQueriesData<Episode>({ queryKey: ['episode'] })) {
        if (episode?.projectId === project._id) episodeIds.add(episode._id)
      }
      for (const id of episodeIds) {
        for (const scene of qc.getQueryData<Scene[]>(['scenes', id]) ?? []) {
          qc.removeQueries({ queryKey: ['shots', scene._id] })
          qc.removeQueries({ queryKey: ['scene-clips', scene._id] })
        }
        for (const key of ['episode', 'episode-status', 'scenes', 'qa']) {
          qc.removeQueries({ queryKey: [key, id] })
        }
      }
      qc.removeQueries({
        queryKey: ['job'],
        predicate: query => (query.state.data as Job | undefined)?.projectId === project._id,
      })
      qc.setQueryData<Project[]>(['projects'], projects => projects?.filter(item => item._id !== project._id))
      for (const key of ['episodes', 'characters', 'locations', 'factions']) {
        qc.removeQueries({ queryKey: [key, project._id] })
      }
    },
    onError: () => qc.invalidateQueries({ queryKey: ['projects'], exact: true }),
  })
  const error = deleteProject.error
  const errorMessage = isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : undefined

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby="delete-project-title"
      aria-describedby="delete-project-description"
      onCancel={event => {
        event.preventDefault()
        if (!deleteProject.isPending) onClose()
      }}
      className="m-auto w-11/12 max-w-md rounded-xl bg-white p-6 text-gray-900 shadow-xl backdrop:bg-black/50"
    >
      <form
        aria-busy={deleteProject.isPending}
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault()
          if (!deleteProject.isPending) deleteProject.mutate()
        }}
      >
        <h2 id="delete-project-title" className="text-lg font-semibold">ลบโปรเจกต์นี้ถาวร?</h2>
        <p id="delete-project-description" className="break-words text-sm text-gray-700">
          การลบ <strong>“{project.title}”</strong> จะลบทุกตอน ตัวละคร ซีน ช็อต พรอมป์
          และไฟล์ของโปรเจกต์ที่เก็บในแอป การลบนี้ย้อนคืนไม่ได้
        </p>
        {error && (
          <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">
            {errorMessage ?? 'ลบโปรเจกต์ไม่สำเร็จ กรุณาลองใหม่'}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={deleteProject.isPending}
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-40"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={deleteProject.isPending}
            className="rounded bg-red-700 px-4 py-2 text-sm text-white hover:bg-red-800 disabled:opacity-50"
          >
            {deleteProject.isPending ? 'กำลังลบ…' : 'ยืนยันลบโปรเจกต์'}
          </button>
        </div>
      </form>
    </dialog>
  )
}

function episodeHref(project: Project, episode: Episode) {
  const openForReview = project.storySource && episode.status === 'ingested'
  return `/projects/${project._id}/ep/${episode._id}${openForReview ? '?review=1' : ''}`
}

function EpisodeRow({ ep, project }: { ep: Episode; project: Project }) {
  const status = ep.productionStatus ?? ep.status
  return (
    <Link
      to={episodeHref(project, ep)}
      className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-3 text-slate-900 last:border-0 hover:bg-indigo-50/60 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-indigo-500 sm:px-6"
    >
      <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-indigo-700">EP {ep.number}</span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{ep.title || `ตอนที่ ${ep.number}`}</span>
      <span className={`shrink-0 rounded-md px-2 py-1 text-xs ${EP_STATUS_COLOR[status] ?? 'bg-gray-100 text-gray-600'}`}>
        {EP_STATUS_LABEL[status] ?? status}
      </span>
      <span aria-hidden="true" className="ml-1 text-slate-500">›</span>
    </Link>
  )
}

function ProjectCard({ project, expanded, onToggle }: { project: Project; expanded: boolean; onToggle: () => void }) {
  const [action, setAction] = useState<'rename' | 'delete' | null>(null)
  const menu = useRef<HTMLDetailsElement>(null)
  const { data: episodes = [], isLoading, isError } = useQuery({
    queryKey: ['episodes', project._id],
    queryFn: () => episodesApi.list(project._id),
    enabled: !project.deletionPending,
    refetchOnMount: 'always',
  })
  const newEpisode = `/projects/${project._id}/ep/new`
  const latest = episodes.at(-1)
  const sourceLabel = project.storySource?.mode === 'story' ? 'เรื่องเต็ม' : project.storySource?.mode === 'outline' ? 'โครงเรื่อง' : 'ใส่ตอนเอง'
  const menuItem = 'block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 focus-visible:bg-indigo-50'

  function openAction(next: 'rename' | 'delete') {
    if (menu.current) {
      menu.current.open = false
      menu.current.querySelector('summary')?.focus()
    }
    setAction(next)
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.035)]">
      <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <ProjectMark />
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-slate-900 sm:text-lg">{project.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-600">
              {project.deletionPending
                ? <span className="text-red-700">การลบยังไม่เสร็จ</span>
                : <>
                    <span>{isLoading ? 'กำลังโหลดตอน…' : isError ? 'โหลดรายการตอนไม่สำเร็จ' : `${episodes.length} ตอน`}</span>
                    <span className="text-slate-400" aria-hidden="true">·</span>
                    <span>{sourceLabel}</span>
                    <span className="text-slate-400" aria-hidden="true">·</span>
                    <time dateTime={project.createdAt}>{new Date(project.createdAt).toLocaleDateString('th-TH', { dateStyle: 'medium' })}</time>
                    {project.genre && <span className="max-w-full break-words rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-700">{project.genre}</span>}
                  </>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 pl-[3.875rem] sm:pl-0">
          {project.deletionPending ? (
            <button type="button" onClick={() => setAction('delete')}
              className="rounded-xl border border-red-200 px-3.5 py-2 text-sm font-medium text-red-700 hover:bg-red-50">ลบต่อ</button>
          ) : (
            <>
              {latest
                ? <button type="button" onClick={onToggle} aria-expanded={expanded}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-indigo-100 bg-indigo-50 px-3.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
                    {expanded ? 'ซ่อนตอน' : 'ดูตอนทั้งหมด'} <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
                  </button>
                : <Link to={newEpisode}
                    className="inline-flex min-h-10 items-center rounded-xl border border-indigo-100 bg-indigo-50 px-3.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">+ เพิ่มตอน</Link>}
              <details
                ref={menu}
                className="relative"
                onBlur={event => {
                  if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    event.currentTarget.open = false
                    event.currentTarget.querySelector('summary')?.focus()
                  }
                }}
              >
                <summary aria-label={`จัดการโปรเจกต์ ${project.title}`}
                  className="grid size-10 cursor-pointer list-none place-items-center rounded-xl border border-slate-200 text-xl leading-none text-slate-700 hover:bg-slate-100 [&::-webkit-details-marker]:hidden">⋯</summary>
                <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                  {latest && <>
                    <Link to={episodeHref(project, latest)} className={menuItem}>เปิดตอนล่าสุด</Link>
                    <Link to={newEpisode} className={menuItem}>เพิ่มตอน</Link>
                    <div className="mx-2 my-1 border-t border-slate-100" />
                  </>}
                  <button type="button" onClick={() => openAction('rename')} className={menuItem}>เปลี่ยนชื่อโปรเจกต์</button>
                  <button type="button" onClick={() => openAction('delete')}
                    className={`${menuItem} text-red-700`}>ลบโปรเจกต์</button>
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      {!project.deletionPending && expanded && episodes.length > 0 && (
        <div className="rounded-b-2xl border-t border-slate-100 bg-slate-50/60">
          {episodes.map(ep => <EpisodeRow key={ep._id} ep={ep} project={project} />)}
        </div>
      )}
      {action === 'rename' && <RenameProjectDialog project={project} onClose={() => setAction(null)} />}
      {action === 'delete' && <DeleteProjectDialog project={project} onClose={() => setAction(null)} />}
    </article>
  )
}

export function Dashboard() {
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const { data: projects = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  })

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 sm:px-8">
          <div className="flex items-center gap-2.5">
            <ProjectMark small />
            <span className="text-sm font-semibold tracking-tight sm:text-base">Novel to Anime</span>
          </div>
          <Link to="/settings" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">ตั้งค่า</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-8 sm:py-11">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">โปรเจกต์</h1>
            {!isLoading && !isError && projects.length > 0 && <p className="mt-1.5 text-sm text-slate-600">{projects.length} โปรเจกต์</p>}
          </div>
          <button type="button" onClick={() => setShowNew(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
            <span aria-hidden="true" className="text-lg leading-none">+</span> สร้างโปรเจกต์
          </button>
        </div>

        {isLoading && <p role="status" className="px-1 py-3 text-sm text-slate-600">กำลังโหลดโปรเจกต์…</p>}
        {isError && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800">
            <span>โหลดโปรเจกต์ไม่สำเร็จ</span>
            <button type="button" onClick={() => { void refetch() }} className="font-semibold underline">ลองใหม่</button>
          </div>
        )}
        {!isLoading && !isError && projects.length === 0 && (
          <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/80 px-5 py-14 text-center">
            <ProjectMark />
            <h2 className="font-semibold text-slate-900">ยังไม่มีโปรเจกต์</h2>
            <p className="text-sm text-slate-600">เริ่มจากเรื่องเต็ม โครงเรื่อง หรือเพิ่มตอนทีละตอน</p>
          </div>
        )}

        <div className="space-y-3">
          {projects.map(project => (
            <ProjectCard key={project._id} project={project} expanded={expandedId === project._id}
              onToggle={() => setExpandedId(current => current === project._id ? null : project._id)} />
          ))}
        </div>
      </main>

      {showNew && <NewProjectDialog onClose={() => setShowNew(false)} onCreated={project => {
        setExpandedId(project.storySource ? project._id : null)
        qc.setQueryData<Project[]>(['projects'], current => [project, ...(current ?? []).filter(p => p._id !== project._id)])
        void qc.invalidateQueries({ queryKey: ['projects'], exact: true })
        setShowNew(false)
      }} />}
    </div>
  )
}
