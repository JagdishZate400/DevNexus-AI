import { ArrowRight, ShieldCheck, ScanSearch } from 'lucide-react'
import { Link } from 'react-router-dom'

function SummaryBlock({ title, icon: Icon, lines, link, action }) {
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-[#232c4b] bg-[#121a2e] p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#1a2340] text-[#34d399]">
          <Icon size={18} />
        </span>
        <h3 className="font-bold text-[#dbe2ef]">{title}</h3>
      </div>
      <div className="mt-5 space-y-2">
        {lines.map((line) => (
          <p key={line} className="text-sm text-[#8f99b0]">{line}</p>
        ))}
      </div>
      <Link to={link} className="mt-auto flex items-center gap-1 pt-6 text-xs font-bold text-[#34d399] hover:text-[#f59e0b]">
        {action}<ArrowRight size={14} />
      </Link>
    </div>
  )
}

function ReviewSecuritySummary({ review, security }) {
  return (
    <section>
      <h2 className="mb-4 text-xl font-bold tracking-tight text-[#eef1f8]">Code Review & Security</h2>
      <div className="flex flex-col gap-4 md:flex-row">
        <SummaryBlock
          title="Code Review"
          icon={ScanSearch}
          lines={[review.reviews, review.suggestions, review.attention]}
          link="/code-review"
          action="View reviews"
        />
        <SummaryBlock
          title="Security"
          icon={ShieldCheck}
          lines={[security.findings, security.high, security.medium]}
          link="/security"
          action="View security findings"
        />
      </div>
    </section>
  )
}

export default ReviewSecuritySummary
