function FindingsFilters({ filters, onChange }) {
  const fields = [['severity', 'Severity', ['All', 'Critical', 'High', 'Medium', 'Low', 'Info']], ['category', 'Category', ['All', 'Code Quality', 'Maintainability', 'Potential Bug', 'Security', 'Performance', 'Best Practice']], ['status', 'Status', ['All', 'Open', 'Reviewed', 'False Positive', 'Fixed']]]
  return <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">{fields.map(([key, label, options]) => <label key={key} className="text-xs font-bold text-[#b9c2d6]">{label}<select value={filters[key]} onChange={(event) => onChange(key, event.target.value)} aria-label={`Filter by ${label.toLowerCase()}`} className="mt-1 block w-full min-w-36 rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm font-normal text-[#8f99b0] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10">{options.map((option) => <option key={option}>{option}</option>)}</select></label>)}</div>
}

export default FindingsFilters
