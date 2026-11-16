import { Download, RotateCcw, Eye } from 'lucide-react'
import { useMemo, useState } from 'react'

const statusStyles = {
  Generated: 'bg-[#1a2340] text-[#34d399]',
  'Needs Update': 'bg-[#f3f0df] text-[#88733e]',
  'Not Generated': 'bg-[#f0f2ed] text-[#75837b]',
}

function DocumentLibrary({ documents, selectedDocId, onSelectDoc, onRegenerate, onExport }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')

  const filteredDocs = useMemo(() => {
    return documents.filter((doc) => {
      const matchesSearch = searchQuery === '' || 
        doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        doc.project.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (doc.type && doc.type.toLowerCase().includes(searchQuery.toLowerCase()))
      
      const matchesStatus = statusFilter === 'All' || doc.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [documents, searchQuery, statusFilter])

  const statusOptions = ['All', 'Generated', 'Needs Update', 'Not Generated']

  return (
    <div className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-4 border-b border-[#1e2642] pb-5 sm:flex-row sm:items-end">
        <div>
          <h2 className="text-xl font-bold text-[#eef1f8]">Generated Documents</h2>
          <p className="mt-1 text-xs text-[#8f99b0]">Browse and manage your project documentation</p>
        </div>
        <span className="shrink-0 text-xs font-bold text-[#34d399]">{filteredDocs.length} documents</span>
      </div>

      {/* Search and Filter */}
      <div className="py-5 border-b border-[#1e2642]">
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Search by title, project, or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm text-[#eef1f8] placeholder-[#8f99b0] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10"
          />
          <div>
            <label className="text-xs font-bold text-[#b9c2d6]">
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-[#2b3558] bg-[#121a2e] px-3 py-2.5 text-sm font-normal text-[#8f99b0] outline-none focus:border-[#f59e0b] focus:ring-4 focus:ring-[#f59e0b]/10"
              >
                {statusOptions.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>

      {/* Documents List */}
      <div className="py-5">
        {filteredDocs.length === 0 ? (
          <div className="rounded-lg border border-[#1e2642] bg-[#0e1428] p-8 text-center">
            <p className="text-sm text-[#8f99b0]">
              {documents.length === 0 
                ? 'No documentation generated yet.' 
                : 'No documentation matches the selected filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredDocs.map((doc) => (
              <article
                key={doc.id}
                onClick={() => onSelectDoc(doc.id)}
                className={`cursor-pointer rounded-lg border bg-[#121a2e] p-4 transition ${
                  selectedDocId === doc.id
                    ? 'border-[#34d399] shadow-[0_4px_12px_rgba(24,61,52,0.06)]'
                    : 'border-[#232c4b] hover:border-[#2b3558]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-[#eef1f8]">{doc.title}</h3>
                    <p className="mt-1 text-xs text-[#8f99b0]">
                      {doc.project} · {doc.type}
                    </p>
                    <p className="mt-1 text-[10px] text-[#8f99b0]">Updated {doc.updated}</p>
                  </div>
                  <span className={`ml-3 shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyles[doc.status]}`}>
                    {doc.status}
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#1e2642] pt-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectDoc(doc.id)
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-[#1a2340] px-2.5 py-1.5 text-[10px] font-semibold text-[#34d399] transition hover:bg-[#1a2340]"
                  >
                    <Eye size={13} /> View
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRegenerate(doc.id)
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-[#f3f0df] px-2.5 py-1.5 text-[10px] font-semibold text-[#88733e] transition hover:bg-[#f0e8cc]"
                  >
                    <RotateCcw size={13} /> Regenerate
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onExport(doc.id)
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-[#efe8f5] px-2.5 py-1.5 text-[10px] font-semibold text-[#603d7a] transition hover:bg-[#1a2340]"
                  >
                    <Download size={13} /> Export
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default DocumentLibrary
