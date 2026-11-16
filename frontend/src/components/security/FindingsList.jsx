import FindingCard from './FindingCard'

function FindingsList({ findings, selectedFindingId, onSelectFinding, onStatusChange }) {
  if (findings.length === 0) {
    return (
      <div className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-8 text-center">
        <p className="text-sm text-[#8f99b0]">No findings match the selected filters.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {findings.map((finding) => (
        <FindingCard
          key={finding.id}
          finding={finding}
          selected={finding.id === selectedFindingId}
          onSelect={() => onSelectFinding(finding.id)}
          onStatusChange={(status) => onStatusChange(finding.id, status)}
        />
      ))}
    </div>
  )
}

export default FindingsList
