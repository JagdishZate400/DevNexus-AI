import { CheckCircle2, FileCode2, ListChecks, ScanSearch } from 'lucide-react'

const icons = [ScanSearch, FileCode2, ListChecks, CheckCircle2]

function ReviewStats({ stats }) {
  const items = [
    {
      label: 'Total Reviews',
      value: String(stats?.totalReviews ?? 0),
      detail: `${stats?.recentThisMonth ?? 0} this month`,
    },
    {
      label: 'Files Reviewed',
      value: String(stats?.filesReviewed ?? 0),
      detail: `Across ${stats?.projectsCount ?? 0} project${stats?.projectsCount === 1 ? '' : 's'}`,
    },
    {
      label: 'Open Findings',
      value: String(stats?.openFindings ?? 0),
      detail: (stats?.openFindings ?? 0) === 1 ? '1 needs attention' : `${stats?.openFindings ?? 0} need attention`,
    },
    {
      label: 'Resolved Findings',
      value: String(stats?.resolvedFindings ?? 0),
      detail: (stats?.totalFindings ?? 0) > 0
        ? `${Math.round(((stats?.resolvedFindings ?? 0) / stats.totalFindings) * 100)}% of total findings`
        : '0% of total findings',
    },
  ]

  return (
    <div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((stat, index) => {
        const Icon = icons[index]
        return (
          <article
            key={stat.label}
            className="card-glow group flex items-center gap-4 rounded-xl border border-[#232c4b] bg-[#121a2e] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#1a2340] text-[#34d399] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110">
              <Icon size={19} />
            </span>
            <div>
              <p className="text-2xl font-bold text-[#eef1f8]">{stat.value}</p>
              <p className="text-xs text-[#8f99b0]">{stat.label}</p>
              <p className="mt-1 text-[10px] text-[#8f99b0]">{stat.detail}</p>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default ReviewStats
