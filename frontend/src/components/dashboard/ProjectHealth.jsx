function ProjectHealth({ health }) {
  return (
    <section className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Overall Project Health</h2>
      </div>
      <div className="mt-6 space-y-5">
        {health.map((item) => (
          <div key={item.label}>
            <div className="mb-2 flex justify-between text-xs">
              <span className="font-semibold text-[#b9c2d6]">{item.label}</span>
              <span className="font-bold text-[#34d399]">{item.value}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#232c4b]">
              <div className="h-full rounded-full progress-fill bg-[#34d399]" style={{ width: `${item.value}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default ProjectHealth
