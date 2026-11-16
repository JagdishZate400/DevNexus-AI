import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import CreateProjectModal from '../components/projects/CreateProjectModal'
import ProjectCard from '../components/projects/ProjectCard'
import ProjectStats from '../components/projects/ProjectStats'
import ProjectsToolbar from '../components/projects/ProjectsToolbar'
import { useAuthStore } from '../store/authStore'
import { useProjectsStore } from '../store/projectsStore'

const defaultFilters = { search: '', status: 'All statuses', technology: 'All technologies', sort: 'Recently Updated' }

function ProjectsPage() {
  const projects = useProjectsStore((state) => state.projects)
  const createProject = useProjectsStore((state) => state.createProject)
  const loadProjects = useProjectsStore((state) => state.loadProjects)
  const isLoading = useProjectsStore((state) => state.isLoading)
  const loadError = useProjectsStore((state) => state.loadError)
  const source = useProjectsStore((state) => state.source)
  const user = useAuthStore((state) => state.user)
  const [filters, setFilters] = useState(defaultFilters)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [createError, setCreateError] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const filteredProjects = useMemo(() => {
    const query = filters.search.toLowerCase().trim()
    const result = projects.filter(
      (project) =>
        (!query || [project.name, project.description, ...(project.stack || [])].join(' ').toLowerCase().includes(query)) &&
        (filters.status === 'All statuses' || project.status === filters.status) &&
        (filters.technology === 'All technologies' || (project.stack || []).includes(filters.technology))
    )
    return [...result].sort((a, b) => {
      if (filters.sort === 'Name A-Z') return a.name.localeCompare(b.name)
      if (filters.sort === 'Newest') return String(b.created || '').localeCompare(String(a.created || ''))
      if (filters.sort === 'Oldest') return String(a.created || '').localeCompare(String(b.created || ''))
      return 0
    })
  }, [filters, projects])

  const orderedProjects = useMemo(() => {
    const real = filteredProjects.filter((p) => !p.isDemo)
    const demo = filteredProjects.filter((p) => Boolean(p.isDemo))
    return [...real, ...demo]
  }, [filteredProjects])

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
  }

  async function handleCreate(project) {
    setCreateError('')
    setIsCreating(true)
    try {
      await createProject({
        ...project,
        owner: user?.name || user?.email?.split('@')[0] || project.owner || 'You',
        ownerEmail: user?.email || undefined,
        ownerId: user?.id || undefined,
      })
      setIsModalOpen(false)
    } catch (err) {
      setCreateError(err.message || 'Could not create project.')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-[1440px] px-5 py-8 sm:px-8 lg:py-10">
      <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Engineering workspace</p>
          <h2 className="text-3xl font-bold tracking-tight text-[#eef1f8] sm:text-4xl">Projects</h2>
          <p className="mt-2 text-sm text-[#8f99b0] sm:text-base">Manage and explore your software engineering projects.</p>
        </div>
        <button
          type="button"
          onClick={() => { setCreateError(''); setIsModalOpen(true) }}
          className="btn-press btn-shine inline-flex w-fit items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-bold text-[#231303] hover:bg-[#fbbf24] focus:outline-none focus:ring-4 focus:ring-[#f59e0b]/20"
        >
          <Plus size={17} /> New Project
        </button>
      </div>

      <ProjectStats projects={projects} />

      <div className="mt-7">
        <ProjectsToolbar filters={filters} onFilterChange={updateFilter} onClear={() => setFilters(defaultFilters)} />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#b9c2d6]">
          {filteredProjects.length} {filteredProjects.length === 1 ? 'project' : 'projects'}
          {isLoading ? ' · Loading…' : ''}
        </h3>
        <p className="text-xs text-[#8f99b0]">{source === 'api' ? 'Synced with backend' : 'Local workspace data'}</p>
      </div>

      {loadError && (
        <p className="mt-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-sm text-[#f87171]">{loadError}</p>
      )}
      {createError && (
        <p className="mt-3 rounded-lg border border-[#f87171]/30 bg-[#f87171]/10 px-4 py-3 text-sm text-[#f87171]">{createError}</p>
      )}

      {orderedProjects.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-[#2b3558] bg-[#121a2e] px-6 py-16 text-center">
          <h3 className="text-lg font-bold text-[#dbe2ef]">No projects found</h3>
          <p className="mt-2 text-sm text-[#8f99b0]">Try adjusting your search or filters to find another project.</p>
          <button type="button" onClick={() => setFilters(defaultFilters)} className="mt-5 text-sm font-bold text-[#34d399] hover:text-[#f59e0b]">
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="animate-stagger mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {orderedProjects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

      <CreateProjectModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={handleCreate}
        isSubmitting={isCreating}
      />
    </section>
  )
}

export default ProjectsPage
