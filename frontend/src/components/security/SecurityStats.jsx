import { AlertCircle, AlertTriangle, Bug, Shield } from 'lucide-react'
import { securityStats as defaultStats } from '../../data/securityData'

const iconMap = {
  AlertCircle,
  AlertTriangle,
  Bug,
  Shield,
}

function SecurityStats({ stats = defaultStats }) {
  return (
    <div className="animate-stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => {
        const Icon = iconMap[stat.icon] || AlertCircle
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

export default SecurityStats
