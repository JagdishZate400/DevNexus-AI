function ReviewHistory({ reviews, selectedId, onSelect, sourceLabel = 'Mock history' }) {
  return (
    <section className="flex flex-col rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Recent Reviews</h2>
        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8f99b0]">{sourceLabel}</span>
      </div>
      <div className="max-h-[500px] overflow-y-auto pr-1 space-y-2">
        {!reviews.length && <p className="text-sm text-[#8f99b0]">No saved repository reviews yet.</p>}
        {reviews.map((review) => (
          <button
            type="button"
            key={review.id}
            onClick={() => onSelect(review.id)}
            className={`w-full rounded-lg border p-3 text-left transition ${
              selectedId === review.id ? 'border-[#34d399] bg-[#1a2340]' : 'border-transparent hover:bg-[#1a2340]'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-[#dbe2ef]">{review.project}</p>
                <p className="mt-1 text-xs text-[#8f99b0]">{review.scope}</p>
              </div>
              <span className="rounded-full bg-[#1a2340] px-2 py-1 text-[10px] font-bold text-[#34d399]">
                {review.status}
              </span>
            </div>
            <div className="mt-3 flex justify-between text-[10px] text-[#8f99b0]">
              <span>{review.findings} findings</span>
              <span>{review.updated}</span>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

export default ReviewHistory
