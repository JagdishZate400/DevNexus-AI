import { useCountUp } from '../../hooks/useCountUp'

function StatCard({ label, value, detail, icon: Icon }) {
  const displayValue = useCountUp(value)
  return (
    <article className="card-glow group rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[#8f99b0]">{label}</p><p className="mt-3 text-3xl font-bold tracking-tight text-[#eef1f8] tabular-nums">{displayValue}</p></div><span className="grid h-10 w-10 place-items-center rounded-lg bg-[#1a2340] text-[#34d399] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"><Icon size={19} /></span></div>
      <p className="mt-3 text-xs text-[#8f99b0]">{detail}</p>
    </article>
  )
}

export default StatCard
