import { CheckSquare, FileText, Flag, FolderKanban, LayoutDashboard, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProjectsStore } from '../../store/projectsStore'
import { useSprintsStore } from '../../store/sprintsStore'
import { useTasksStore } from '../../store/tasksStore'
import { useTeamStore } from '../../store/teamStore'

const pageLinks = [
  { label: 'Dashboard', path: '/dashboard', Icon: LayoutDashboard },
  { label: 'Projects', path: '/projects', Icon: FolderKanban },
  { label: 'Tasks', path: '/tasks', Icon: CheckSquare },
  { label: 'Sprints', path: '/sprints', Icon: Flag },
  { label: 'Team', path: '/team', Icon: Users },
  { label: 'AI Chat', path: '/ai-chat', Icon: FileText },
  { label: 'Reports', path: '/reports', Icon: FileText },
]

function SearchPalette({ isOpen, onClose }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const projects = useProjectsStore((state) => state.projects)
  const tasks = useTasksStore((state) => state.tasks)
  const sprints = useSprintsStore((state) => state.sprints)
  const members = useTeamStore((state) => state.members)

  useEffect(() => {
    if (!isOpen) return undefined
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [isOpen])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matches = (text) => !q || String(text || '').toLowerCase().includes(q)
    const items = [
      ...projects.filter((p) => matches(`${p.name} ${p.description}`)).slice(0, 4).map((p) => ({
        id: `project-${p.id}`,
        label: p.name,
        detail: `Project · ${p.status}`,
        Icon: FolderKanban,
        path: `/projects/${p.id}`,
      })),
      ...tasks.filter((t) => matches(`${t.title} ${t.project}`)).slice(0, 4).map((t) => ({
        id: `task-${t.id}`,
        label: t.title,
        detail: `Task · ${t.status}`,
        Icon: CheckSquare,
        path: '/tasks',
      })),
      ...sprints.filter((s) => matches(`${s.name} ${s.goal}`)).slice(0, 3).map((s) => ({
        id: `sprint-${s.id}`,
        label: s.name,
        detail: `Sprint · ${s.status}`,
        Icon: Flag,
        path: '/sprints',
      })),
      ...members.filter((m) => matches(`${m.name} ${m.email}`)).slice(0, 3).map((m) => ({
        id: `member-${m.id}`,
        label: m.name,
        detail: `Team · ${m.role}`,
        Icon: Users,
        path: '/team',
      })),
      ...pageLinks.filter((page) => matches(page.label)).map((page) => ({
        id: `page-${page.path}`,
        label: page.label,
        detail: 'Go to page',
        Icon: page.Icon,
        path: page.path,
      })),
    ]
    return items.slice(0, 12)
  }, [query, projects, tasks, sprints, members])

  // Clamped during render so shrinking results never strand the highlight.
  const safeIndex = Math.min(activeIndex, Math.max(0, results.length - 1))

  if (!isOpen) return null

  function goTo(path) {
    onClose()
    navigate(path)
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && results[safeIndex]) {
      goTo(results[safeIndex].path)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[#05070f]/60 p-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search workspace dialog"
      onClick={onClose}
    >
      <div
        className="modal-panel w-full max-w-lg overflow-hidden rounded-2xl border border-[#232c4b] bg-[#121a2e] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search projects, tasks, sprints, people, pages..."
          aria-label="Search workspace"
          className="w-full border-b border-[#232c4b] bg-transparent px-5 py-4 text-sm text-[#eef1f8] outline-none placeholder:text-[#8f99b0]"
        />
        <div className="max-h-80 overflow-y-auto p-2">
          {results.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-[#8f99b0]">No matches. Try a project, task, or page name.</p>
          ) : (
            results.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(item.path)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${index === safeIndex ? 'bg-[#1a2340]' : ''}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#1a2340] text-[#34d399]">
                  <item.Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-[#dbe2ef]">{item.label}</span>
                  <span className="block truncate text-xs text-[#8f99b0]">{item.detail}</span>
                </span>
              </button>
            ))
          )}
        </div>
        <p className="border-t border-[#232c4b] px-5 py-2.5 text-[11px] text-[#8f99b0]">↑↓ to move · Enter to open · Esc to close</p>
      </div>
    </div>
  )
}

export default SearchPalette
