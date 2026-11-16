import { Archive, ArrowUpRight, Eye, MoreHorizontal, Trash2, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProjectsStore } from '../../store/projectsStore'
import { useAuthStore } from '../../store/authStore'
import { canManageProject, canDeleteProject } from '../../utils/projectPermissions'

const statusStyles = { Active: 'bg-[#1a2340] text-[#34d399]', 'Analysis Complete': 'bg-[#e7eef1] text-[#416676]', Archived: 'bg-[#f0f2ed] text-[#75837b]' }

function ProjectCard({ project }) {
  const updateProject = useProjectsStore((state) => state.updateProject)
  const removeProject = useProjectsStore((state) => state.removeProject)
  const user = useAuthStore((state) => state.user)
  const canManage = !project.isDemo && canManageProject(user, project)
  const canDelete = !project.isDemo && canDeleteProject(user, project)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [actionError, setActionError] = useState('')
  const menuRef = useRef(null)

  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
        setConfirmingDelete(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  async function toggleArchive() {
    if (!canManage) {
      setActionError('You do not have permission to modify this project.')
      return
    }
    setActionError('')
    try {
      await updateProject(project.id, { status: project.status === 'Archived' ? 'Active' : 'Archived' })
      setMenuOpen(false)
    } catch (err) {
      setActionError(err.message || 'Could not update the project.')
    }
  }

  async function handleDelete() {
    if (!canDelete) {
      setActionError('You do not have permission to delete this project.')
      return
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setActionError('')
    try {
      await removeProject(project.id)
      setMenuOpen(false)
    } catch (err) {
      setActionError(err.message || 'Could not delete the project.')
    } finally {
      setConfirmingDelete(false)
    }
  }

  return (
    <article className="card-glow group flex min-h-[270px] flex-col rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#1a2340] text-sm font-bold text-[#34d399]">
          {project.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}
        </span>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label={`More actions for ${project.name}`}
            aria-expanded={menuOpen}
            onClick={() => { setMenuOpen((open) => !open); setConfirmingDelete(false); setActionError('') }}
            className="rounded-md p-1.5 text-[#8f99b0] hover:bg-[#1a2340] hover:text-[#34d399]"
          >
            <MoreHorizontal size={19} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 w-48 rounded-lg border border-[#232c4b] bg-[#0e1428] p-1.5 shadow-xl">
              <Link
                to={`/projects/${project.id}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold text-[#b9c2d6] hover:bg-[#1a2340] hover:text-[#eef1f8]"
              >
                <Eye size={14} /> View details
              </Link>
              {canManage && (
                <button
                  type="button"
                  onClick={toggleArchive}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-bold text-[#b9c2d6] hover:bg-[#1a2340] hover:text-[#eef1f8]"
                >
                  <Archive size={14} /> {project.status === 'Archived' ? 'Unarchive' : 'Archive'}
                </button>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-bold hover:bg-[#1a2340] ${confirmingDelete ? 'text-[#f87171]' : 'text-[#b9c2d6] hover:text-[#f87171]'}`}
                >
                  <Trash2 size={14} /> {confirmingDelete ? 'Confirm delete' : 'Delete'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="mt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-[#dbe2ef]">{project.name}</h3>
          <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusStyles[project.status]}`}>{project.status}</span>
          {project.isDemo && (
            <span className="rounded-full border border-[#f59e0b]/40 bg-[#f59e0b]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#fbbf24]">
              Demo
            </span>
          )}
        </div>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-[#8f99b0]">{project.description}</p>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {project.stack.map((technology) => (
          <span key={technology} className="rounded-md border border-[#1a2340] bg-[#0e1428] px-2 py-1 text-[10px] font-semibold text-[#8f99b0]">{technology}</span>
        ))}
      </div>
      {actionError && <p role="alert" className="mt-3 text-xs font-medium text-[#f87171]">{actionError}</p>}
      <div className="mt-auto pt-5">
        <div className="mb-3 flex items-center justify-between text-xs text-[#8f99b0]">
          <span>Analysis progress</span>
          <span className="font-bold text-[#34d399]">{project.progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[#232c4b]">
          <div className="h-full rounded-full progress-fill progress-animated bg-gradient-to-r from-[#34d399] to-[#fbbf24]" style={{ width: `${project.progress}%` }} />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-[#1e2642] pt-4">
          <span className="flex items-center gap-1.5 text-xs text-[#8f99b0]"><Users size={14} /> {project.teamSize} members · {project.updated}</span>
          <Link to={`/projects/${project.id}`} className="group/link flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-[#34d399] hover:text-[#f59e0b]">
            View Project <ArrowUpRight size={14} className="transition-transform duration-200 group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </article>
  )
}

export default ProjectCard
