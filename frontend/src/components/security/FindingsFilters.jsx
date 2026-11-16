import { categoryOptions, severityOptions, statusOptions, typeOptions } from '../../data/securityData'

function FindingsFilters({ filters, onFilterChange, searchQuery, onSearchChange }) {
  const fields = [
    ['severity', 'Severity', severityOptions],
    ['type', 'Type', typeOptions],
    ['category', 'Category', categoryOptions],
    ['status', 'Status', statusOptions],
  ]

  return (
    <div className="flex flex-col gap-4 sm:gap-3">
      <input
        type="text"
        placeholder="Search by title, file, or category..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm text-[#eef1f8] placeholder-[#8f99b0] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {fields.map(([key, label, options]) => (
          <label key={key} className="text-xs font-bold text-[#b9c2d6]">
            {label}
            <select
              value={filters[key]}
              onChange={(event) => onFilterChange(key, event.target.value)}
              aria-label={`Filter by ${label.toLowerCase()}`}
              className="mt-1 block w-full min-w-36 rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm font-normal text-[#8f99b0] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10"
            >
              {options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  )
}

export default FindingsFilters
