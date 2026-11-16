import { useCountUp } from '../../hooks/useCountUp'

function AIOverviewCell({ item }) {
  const displayValue = useCountUp(item.value)
  return (
    <div className="bg-[#121a2e] p-4 transition-colors duration-200 hover:bg-[#1a2340]">
      <p className="text-2xl font-bold tabular-nums text-[#eef1f8]">{displayValue}</p>
      <p className="mt-1 text-xs leading-5 text-[#8f99b0]">{item.label}</p>
    </div>
  )
}

function AIOverview({ items }) {
  return (
    <section>
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#fbbf24]">Signal, not certainty</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-[#eef1f8]">AI Engineering Overview</h2>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#232c4b] bg-[#232c4b] sm:grid-cols-4">
        {items.map((item) => (
          <AIOverviewCell key={item.label} item={item} />
        ))}
      </div>
    </section>
  )
}

export default AIOverview
