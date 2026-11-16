const statusStyles = {
  'In Progress': 'bg-[#e7eef1] text-[#416676]',
  Todo: 'bg-[#f0f2ed] text-[#75837b]',
  Review: 'bg-[#f2e9df] text-[#a66542]',
  Done: 'bg-[#1a2340] text-[#34d399]',
}

function TaskProgress({ progress, tasks }) {
  return (
    <section className="rounded-xl border border-[#232c4b] bg-[#121a2e] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between">
        <h2 className="text-xl font-bold tracking-tight text-[#eef1f8]">Task Progress</h2>
        <span className="text-sm font-bold text-[#34d399]">{progress.completion}%</span>
      </div>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#232c4b]">
        <div
          className="h-full rounded-full progress-fill progress-animated bg-gradient-to-r from-[#f59e0b] to-[#fbbf24]"
          style={{ width: `${progress.completion}%` }}
        />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="font-bold text-[#dbe2ef]">{progress.completed}</p>
          <p className="mt-1 text-[#8f99b0]">Completed</p>
        </div>
        <div>
          <p className="font-bold text-[#dbe2ef]">{progress.inProgress}</p>
          <p className="mt-1 text-[#8f99b0]">In Progress</p>
        </div>
        <div>
          <p className="font-bold text-[#dbe2ef]">{progress.todo}</p>
          <p className="mt-1 text-[#8f99b0]">Todo</p>
        </div>
      </div>
      <div className="mt-6 space-y-3 border-t border-[#1e2642] pt-4">
        {tasks.map((task) => (
          <div key={task.label} className="flex items-center justify-between gap-3">
            <p className="truncate text-sm text-[#b9c2d6]">{task.label}</p>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${statusStyles[task.status] || statusStyles.Todo}`}>
              {task.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export default TaskProgress
