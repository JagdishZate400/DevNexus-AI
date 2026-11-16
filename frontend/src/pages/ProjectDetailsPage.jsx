import { Archive, ArrowLeft, Edit3, ExternalLink, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ProjectActivity from '../components/projects/ProjectActivity'
import ProjectDetailsTabs from '../components/projects/ProjectDetailsTabs'
import ProjectOverview from '../components/projects/ProjectOverview'
import { projectActivity } from '../data/projectsData'
import { useProjectsStore } from '../store/projectsStore'
import { useAuthStore } from '../store/authStore'
import { canManageProject } from '../utils/projectPermissions'

const STATUSES = ['Active', 'Archived', 'Analysis Complete']

function EditProjectModal({ project, onClose, onSave }) {
  const [form, setForm] = useState({
    name: project.name,
    description: project.description,
    status: project.status,
  })
  const [errors, setErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function updateField(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: '' }))
  }

  async function submitForm(event) {
    event.preventDefault()
    const nextErrors = {}
    if (!form.name.trim()) nextErrors.name = 'Name is required.'
    if (!form.description.trim()) nextErrors.description = 'Description is required.'
    setErrors(nextErrors)
    if (Object.values(nextErrors).some(Boolean)) return
    setIsSubmitting(true)
    setSubmitError('')
    try {
      await onSave({
        name: form.name.trim(),
        description: form.description.trim(),
        status: form.status,
      })
      onClose()
    } catch (err) {
      setSubmitError(err.message || 'Could not save the project.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/45 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-project-title">
      <div className="modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#232c4b] bg-[#121a2e] p-6 shadow-2xl sm:p-8">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#fbbf24]">Edit project</p>
            <h2 id="edit-project-title" className="mt-2 text-2xl font-bold tracking-tight text-[#eef1f8]">Project settings</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close project settings" className="rounded-lg p-2 text-[#8f99b0] hover:bg-[#1a2340]">
            <X size={19} />
          </button>
        </div>
        <form onSubmit={submitForm} noValidate className="mt-7 space-y-4">
          <div>
            <label htmlFor="edit-name" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Name</label>
            <input id="edit-name" name="name" value={form.name} onChange={updateField} className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3.5 py-3 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b]" />
            {errors.name && <p className="mt-1.5 text-xs font-medium text-[#f87171]">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="edit-description" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Description</label>
            <textarea id="edit-description" name="description" value={form.description} onChange={updateField} rows="3" className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3.5 py-3 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b]" />
            {errors.description && <p className="mt-1.5 text-xs font-medium text-[#f87171]">{errors.description}</p>}
          </div>
          <div>
            <label htmlFor="edit-status" className="mb-2 block text-sm font-semibold text-[#dbe2ef]">Status</label>
            <select id="edit-status" name="status" value={form.status} onChange={updateField} className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3.5 py-3 text-sm text-[#eef1f8] outline-none focus:border-[#f59e0b]">
              {STATUSES.map((status) => <option key={status}>{status}</option>)}
            </select>
          </div>
          {submitError && <p role="alert" className="text-xs font-medium text-[#f87171]">{submitError}</p>}
          <div className="flex flex-col-reverse gap-3 pt-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className="rounded-lg border border-[#2b3558] px-4 py-2.5 text-sm font-bold text-[#b9c2d6] hover:bg-[#1a2340]">Cancel</button>
            <button type="submit" disabled={isSubmitting} className="btn-shine rounded-lg bg-[#f59e0b] px-4 py-2.5 text-sm font-bold text-[#231303] hover:bg-[#fbbf24] disabled:opacity-60">Save changes</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProjectDetailsPage() {
  const { projectId } = useParams()
  const project = useProjectsStore((state) => state.projects.find((item) => item.id === projectId))
  const fetchProject = useProjectsStore((state) => state.fetchProject)
  const updateProject = useProjectsStore((state) => state.updateProject)
  const user = useAuthStore((state) => state.user)
  const canManage = !project?.isDemo && canManageProject(user, project)
  const [activeTab, setActiveTab] = useState('Overview')
  const [isEditing, setIsEditing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [isLoading, setIsLoading] = useState(() => Boolean(projectId))
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    if (!projectId) return
    let isMounted = true

    fetchProject(projectId)
      .catch((err) => {
        if (isMounted) setFetchError(err)
      })
      .finally(() => {
        if (isMounted) setIsLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [projectId, fetchProject])

  async function toggleArchive() {
    if (!canManage) {
      setActionError('You do not have permission to modify this project.')
      return
    }
    setActionError('')
    try {
      await updateProject(projectId, { status: project.status === 'Archived' ? 'Active' : 'Archived' })
    } catch (err) {
      setActionError(err.message || 'Could not update the project.')
    }
  }

  if (fetchError && fetchError.status === 403) {
    return (
      <section className="mx-auto max-w-5xl px-5 py-10">
        <Link to="/projects" className="flex items-center gap-2 text-sm font-bold text-[#34d399]">
          <ArrowLeft size={16} /> Back to projects
        </Link>
        <h2 className="mt-12 text-3xl font-bold text-[#eef1f8]">Access Denied</h2>
        <p className="mt-3 text-[#8f99b0]">You do not have permission to view or manage this project.</p>
      </section>
    )
  }

  if (isLoading && !project) {
    return (
      <section className="mx-auto max-w-5xl px-5 py-10">
        <Link to="/projects" className="flex items-center gap-2 text-sm font-bold text-[#34d399]">
          <ArrowLeft size={16} /> Back to projects
        </Link>
        <h2 className="mt-12 text-3xl font-bold text-[#eef1f8]">Loading project…</h2>
      </section>
    )
  }

  if (!project) {
    return (
      <section className="mx-auto max-w-5xl px-5 py-10">
        <Link to="/projects" className="flex items-center gap-2 text-sm font-bold text-[#34d399]">
          <ArrowLeft size={16} /> Back to projects
        </Link>
        <h2 className="mt-12 text-3xl font-bold text-[#eef1f8]">Project not found</h2>
        <p className="mt-3 text-[#8f99b0]">This project is not in your workspace. It may have been deleted.</p>
      </section>
    )
  }

  return (
    <section className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10">
      <Link to="/projects" className="inline-flex items-center gap-2 text-xs font-bold text-[#34d399] hover:text-[#f59e0b]">
        <ArrowLeft size={15} /> Back to projects
      </Link>
      <div className="mt-6 flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-[#1a2340] text-sm font-bold text-[#34d399]">
            {project.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-bold tracking-tight text-[#eef1f8]">{project.name}</h2>
              <span className="rounded-full bg-[#1a2340] px-2.5 py-1 text-[10px] font-bold text-[#34d399]">{project.status}</span>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8f99b0]">{project.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/workspace" className="btn-shine inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-3.5 py-2.5 text-xs font-bold text-[#231303] hover:bg-[#fbbf24]">
            <ExternalLink size={15} /> Open Workspace
          </Link>
          {canManage && (
            <>
              <button type="button" onClick={() => setIsEditing(true)} aria-label="Edit project" title="Edit project" className="rounded-lg border border-[#2b3558] p-2.5 text-[#8f99b0] hover:bg-[#1a2340] hover:text-[#eef1f8]">
                <Edit3 size={16} />
              </button>
              <button
                type="button"
                onClick={toggleArchive}
                aria-label={project.status === 'Archived' ? 'Unarchive project' : 'Archive project'}
                title={project.status === 'Archived' ? 'Unarchive project' : 'Archive project'}
                className="rounded-lg border border-[#2b3558] p-2.5 text-[#8f99b0] hover:bg-[#1a2340] hover:text-[#eef1f8]"
              >
                <Archive size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-[#f87171]">
          {actionError}
        </p>
      )}

      <div className="mt-8 grid gap-3 border-y border-[#232c4b] py-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div><span className="text-[#8f99b0]">Owner</span><p className="mt-1 font-bold text-[#b9c2d6]">{project.owner}</p></div>
        <div><span className="text-[#8f99b0]">Team members</span><p className="mt-1 font-bold text-[#b9c2d6]">{project.teamSize} members</p></div>
        <div><span className="text-[#8f99b0]">Last updated</span><p className="mt-1 font-bold text-[#b9c2d6]">{project.updated}</p></div>
        <div><span className="text-[#8f99b0]">Created</span><p className="mt-1 font-bold text-[#b9c2d6]">{project.created}</p></div>
      </div>

      <div className="mt-8">
        <ProjectDetailsTabs activeTab={activeTab} onChange={setActiveTab} />
      </div>
      <div className="mt-6">
        {activeTab === 'Overview' ? (
          <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
            <ProjectOverview project={project} />
            <ProjectActivity activities={projectActivity} />
          </div>
        ) : activeTab === 'Activity' ? (
          <ProjectActivity activities={projectActivity} />
        ) : (
          <ProjectOverview project={project} />
        )}
      </div>

      {isEditing && (
        <EditProjectModal
          project={project}
          onClose={() => setIsEditing(false)}
          onSave={(patch) => { if (!canManage) throw new Error('You do not have permission to edit this project.'); return updateProject(projectId, patch); }}
        />
      )}
    </section>
  )
}

export default ProjectDetailsPage
