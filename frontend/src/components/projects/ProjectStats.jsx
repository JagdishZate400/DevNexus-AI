import { Archive, BarChart3, FolderKanban, Zap } from 'lucide-react'
import { useMemo } from 'react'

const icons = [FolderKanban, Zap, BarChart3, Archive]

function ProjectStats({ projects = [] }) {
  const stats = useMemo(() => {
    const total = projects.length
    const active = projects.filter((p) => p.status === 'Active').length
    const complete = projects.filter((p) => p.status === 'Analysis Complete').length
    const archived = projects.filter((p) => p.status === 'Archived').length
    return [
      { label: 'Total Projects', value: String(total) },
      { label: 'Active', value: String(active) },
      { label: 'Analysis Complete', value: String(complete) },
      { label: 'Archived', value: String(archived) },
    ]
  }, [projects])

  return (
    <div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat, index) => {
        const Icon = icons[index]
        return (
          <article key={stat.label} className="card-glow group flex items-center gap-4 rounded-xl border border-[#232c4b] bg-[#121a2e] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#1a2340] text-[#34d399] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
              <Icon size={19} />
            </span>
            <div>
              <p className="text-2xl font-bold text-[#eef1f8]">{stat.value}</p>
              <p className="text-xs text-[#8f99b0]">{stat.label}</p>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default ProjectStats
