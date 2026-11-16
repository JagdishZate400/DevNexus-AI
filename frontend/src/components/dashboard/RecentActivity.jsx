function RecentActivity({ activities }) {
  return (
    <section className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Recent Activity</h2>
      <div className="mt-5 space-y-5">
        {activities.map(({ label, time, icon: Icon }, index) => (
          <div key={`${index}-${label}`} className="row-slide group flex gap-3 rounded-lg">
            <div className="relative flex w-8 shrink-0 justify-center">
              <span className="z-10 grid h-8 w-8 place-items-center rounded-full bg-[#1a2340] text-[#34d399] transition-transform duration-300 group-hover:scale-110">
                <Icon size={15} />
              </span>
              {index < activities.length - 1 && (
                <span className="absolute top-8 h-6 w-px bg-[#232c4b]" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#dbe2ef]">{label}</p>
              <p className="mt-1 text-xs text-[#8f99b0]">{time}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default RecentActivity
