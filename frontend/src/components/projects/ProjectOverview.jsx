import { Activity, CheckSquare, FileCode2, Users } from 'lucide-react'

function ProjectOverview({ project }) {
  const cards = [['Files', '42', FileCode2], ['Team Members', String(project.teamSize), Users], ['Open Tasks', '7', CheckSquare], ['AI Analyses', '3', Activity]]
  return <div className="space-y-6"><div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]) => <div key={label} className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-4"><Icon size={18} className="text-[#34d399]" /><p className="mt-4 text-2xl font-bold text-[#eef1f8]">{value}</p><p className="mt-1 text-xs text-[#8f99b0]">{label}</p></div>)}</div><div className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5"><h3 className="font-bold text-[#dbe2ef]">Project summary</h3><p className="mt-3 max-w-2xl text-sm leading-7 text-[#8f99b0]">This mock overview provides a starting point for understanding project progress. Detailed repository insights and AI-generated summaries will be connected in a future phase.</p></div></div>
}

export default ProjectOverview
