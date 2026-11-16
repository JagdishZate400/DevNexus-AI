function ProjectActivity({ activities }) {
  return <section className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5"><h3 className="font-bold text-[#dbe2ef]">Recent activity</h3><div className="mt-5 space-y-5">{activities.map((activity, index) => <div key={`${activity.label}-${activity.time}`} className="flex gap-3"><span className="relative mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full bg-[#34d399]">{index < activities.length - 1 && <span className="absolute left-1/2 top-3 h-8 w-px -translate-x-1/2 bg-[#232c4b]" />}</span><div><p className="text-sm font-semibold text-[#b9c2d6]">{activity.label}</p><p className="mt-1 text-xs text-[#8f99b0]">{activity.time}</p></div></div>)}</div></section>
}

export default ProjectActivity
