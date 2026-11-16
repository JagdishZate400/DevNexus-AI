import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAIChatStore } from '../../store/aiChatStore'
import { workspaceApi, isMockToken } from '../../services/api'
import { useAuthStore } from '../../store/authStore'

function ProjectSelector() {
  const { selectedProjectId, setSelectedProjectId } = useAIChatStore()
  const token = useAuthStore((s) => s.token)
  const [projects, setProjects] = useState([])
  const [error, setError] = useState('')
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    if (!isMockToken(token)) workspaceApi.projects(token, controller.signal).then((data) => { if (!controller.signal.aborted) { setProjects(data.projects); setError('') } }).catch((err) => { if (!controller.signal.aborted) { setProjects([]); setError(err.message) } })
    return () => controller.abort()
  }, [token])

  const availableProjects = [{ id: null, name: 'General chat (no project)' }, ...projects.map((p) => ({ id: p.id, name: p.name }))]

  const currentProject = availableProjects.find((p) => p.id === selectedProjectId)

  const handleSelect = (projectId) => {
    setSelectedProjectId(projectId)
    setIsOpen(false)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between rounded-lg border border-[#232c4b] bg-[#121a2e] px-4 py-3 text-sm font-medium text-[#eef1f8] hover:bg-[#121a2e] focus:outline-none focus:ring-2 focus:ring-[#f59e0b]"
      >
        <span>{currentProject?.name || 'Select Project'}</span>
        <ChevronDown size={18} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {error && <p role="alert" className="mt-2 text-xs text-[#f87171]">{error}</p>}
      {isOpen && (
        <div className="absolute top-full mt-2 w-full rounded-lg border border-[#232c4b] bg-[#121a2e] shadow-lg z-10">
          {availableProjects.map((project) => (
            <button
              key={project.id || 'general'}
              onClick={() => handleSelect(project.id)}
              className={`w-full px-4 py-3 text-left text-sm transition-colors ${
                selectedProjectId === project.id
                  ? 'bg-[#1a2340] text-[#eef1f8] font-medium'
                  : 'text-[#eef1f8] hover:bg-[#0a0f1e]'
              }`}
            >
              {project.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default ProjectSelector
