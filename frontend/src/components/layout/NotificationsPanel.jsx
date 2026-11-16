import { CheckCheck } from 'lucide-react'

function NotificationsPanel({ notifications, onSelect, onMarkAllRead }) {
  const unread = notifications.filter((item) => !item.read).length

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="animate-pop-in absolute right-0 top-12 z-50 max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-[#232c4b] bg-[#121a2e] shadow-[0_16px_48px_rgba(0,0,0,0.55)]"
    >
      <div className="flex items-center justify-between border-b border-[#232c4b] px-4 py-3">
        <p className="text-sm font-bold text-[#eef1f8]">
          Notifications{unread > 0 && <span className="ml-2 rounded-full bg-[#f59e0b] px-2 py-0.5 text-[10px] font-bold text-[#231303]">{unread} new</span>}
        </p>
        {unread > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-[#34d399] hover:bg-[#1a2340]"
          >
            <CheckCheck size={13} /> Mark all read
          </button>
        )}
      </div>
      {notifications.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[#8f99b0]">You&apos;re all caught up.</p>
      ) : (
        <ul className="max-h-[50vh] divide-y divide-[#232c4b] overflow-y-auto">
          {notifications.map(({ id, title, detail, icon: Icon, read }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#1a2340] ${read ? 'opacity-60' : ''}`}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#1a2340] text-[#34d399]">
                  <Icon size={15} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#dbe2ef]">{title}</span>
                  <span className="mt-0.5 block truncate text-xs text-[#8f99b0]">{detail}</span>
                </span>
                {!read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#fbbf24]" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default NotificationsPanel
