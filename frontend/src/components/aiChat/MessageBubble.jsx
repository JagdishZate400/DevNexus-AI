import { FileText } from 'lucide-react'
import { useAIChatStore } from '../../store/aiChatStore'
import MarkdownContent from './MarkdownContent'

function MessageBubble({ message }) {
  const { setSelectedSourcePath } = useAIChatStore()
  const isUser = message.role === 'user'

  const handleCitationClick = (source) => {
    if (source) {
      setSelectedSourcePath(source)
    }
  }

  return (
    <div className={`message-enter flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div
        className={`mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isUser ? 'bg-[#f59e0b] text-[#231303]' : 'bg-[#34d399] text-[#0a0f1e]'
        }`}
      >
        {isUser ? 'U' : 'A'}
      </div>

      <div className={`flex flex-1 flex-col gap-2.5 ${isUser ? 'items-end' : 'items-start'} min-w-0`}>
        <div
          className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-[#f59e0b] text-[#231303] max-w-xl shadow-sm'
              : 'bg-[#1a2340] text-[#eef1f8] w-full max-w-3xl shadow-md border border-[#232c4b]/50'
          }`}
        >
          <MarkdownContent
            content={message.content}
            sources={message.sources}
            isUser={isUser}
            onSourceClick={handleCitationClick}
          />
        </div>

        {!isUser && message.mode && (
          <p className="text-xs text-[#8f99b0]">
            {message.mode === 'repository'
              ? message.grounded
                ? 'Repository-grounded • PostgreSQL source retrieval'
                : 'Repository context unavailable • answer unverified'
              : 'General chat • no repository source used'}
          </p>
        )}

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-1 w-full max-w-3xl">
            <div className="rounded-lg bg-[#1a2340] p-3 border border-[#232c4b]/60">
              <p className="mb-2 text-xs font-semibold text-[#34d399] flex items-center gap-1.5">
                <FileText size={13} />
                Sources used
              </p>
              <div className="space-y-1">
                {message.sources.map((source, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setSelectedSourcePath(source)}
                    className="block text-left text-xs text-[#34d399] hover:text-[#fbbf24] hover:underline font-medium transition-colors"
                  >
                    • {typeof source === 'string'
                      ? source
                      : `${source.citationId ? `[${source.citationId}] ` : ''}${source.path}${source.startLine ? `:${source.startLine}-${source.endLine}` : ''}`}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default MessageBubble
