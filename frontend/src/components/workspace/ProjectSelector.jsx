import { ChevronDown } from 'lucide-react'

function ProjectSelector({ projects, selectedProjectId, onChange, disabled }) {
  return <div><label htmlFor="workspace-project" className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-[#8f99b0]">Project</label><div className="relative"><select id="workspace-project" disabled={disabled} value={selectedProjectId} onChange={(event) => onChange(event.target.value)} className="w-full appearance-none rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 pr-9 text-sm font-bold text-[#dbe2ef] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10">{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8f99b0]" size={16} /></div></div>
}

export default ProjectSelector
