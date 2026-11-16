import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'

function RecentProjects({ projects }) {
  return (
    <section className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Recent Projects</h2>
        <Link to="/projects" className="link-underline text-xs font-bold text-[#34d399] hover:text-[#f59e0b]">View all</Link>
      </div>
      <div className="space-y-1">
        {projects.map((project) => (
          <div key={project.name} className="row-slide group flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-[#0e1428]">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#1a2340] text-xs font-bold text-[#34d399] transition-transform duration-300 group-hover:scale-105">
              {project.icon}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-[#dbe2ef]">{project.name}</p>
              <p className="mt-1 truncate text-xs text-[#8f99b0]">{project.stack}</p>
            </div>
            <div className="hidden text-right sm:block">
              <span className={`animate-pop-in rounded-full px-2.5 py-1 text-[10px] font-bold ${project.status === 'Active' ? 'bg-[#1a2340] text-[#34d399]' : 'bg-[#f2e9df] text-[#a66542]'}`}>
                {project.status}
              </span>
              <p className="mt-2 text-[10px] text-[#8f99b0]">{project.updated}</p>
            </div>
            <Link to="/projects" aria-label={`View ${project.name}`} className="rounded-md p-2 text-[#8f99b0] hover:bg-[#1a2340] hover:text-[#34d399]">
              <ArrowUpRight size={17} className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}

export default RecentProjects
