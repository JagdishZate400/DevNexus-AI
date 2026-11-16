import { Trash2 } from 'lucide-react'
import { useAIChatStore } from '../../store/aiChatStore'

function ConversationSidebar() {
  const { conversations, selectedConversationId, setSelectedConversationId, createNewConversation, deleteConversation, selectedProjectId } = useAIChatStore()

  const projectConversations = conversations.filter((conv) => conv.projectId === selectedProjectId)

  const handleNewChat = async () => {
    try {
      await createNewConversation(selectedProjectId)
    } catch {
      // Error is displayed via loadError in the store
    }
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    try {
      await deleteConversation(id)
    } catch {
      // Error is displayed via loadError in the store
    }
  }

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  return (
    <aside className="flex w-full flex-col border-r border-[#232c4b] bg-[#121a2e]">
      <div className="border-b border-[#232c4b] p-4">
        <button
          onClick={handleNewChat}
          className="btn-press btn-shine w-full rounded-lg bg-[#f59e0b] px-3 py-2 text-sm font-semibold text-[#231303] hover:bg-[#fbbf24] focus:outline-none focus:ring-2 focus:ring-[#f59e0b]"
        >
          + New Chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {projectConversations.length === 0 ? (
          <div className="flex items-center justify-center px-4 py-8 text-center">
            <p className="text-xs text-[#8f99b0]">No conversations yet. Start a new chat to begin.</p>
          </div>
        ) : (
          <div className="space-y-1 p-2">
            {projectConversations.map((conv) => (
              <div
                key={conv.id}
                className={`group relative rounded-lg p-3 transition-all duration-200 ${
                  selectedConversationId === conv.id
                    ? 'bg-[#1a2340] shadow-[inset_2px_0_0_#f59e0b]'
                    : 'hover:translate-x-0.5 hover:bg-[#1a2340]'
                }`}
              >
                <button
                  onClick={() => setSelectedConversationId(conv.id)}
                  className="w-full text-left"
                >
                  <p className="line-clamp-2 text-sm font-medium text-[#eef1f8]">{conv.title}</p>
                  <p className="mt-1 text-xs text-[#8f99b0]">{formatTimestamp(conv.timestamp)}</p>
                </button>
                <button
                  onClick={(e) => handleDelete(e, conv.id)}
                  className="absolute right-2 top-2 hidden rounded p-1 text-[#8f99b0] hover:bg-[#232c4b] hover:text-[#f87171] group-hover:block"
                  title="Delete conversation"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

export default ConversationSidebar
