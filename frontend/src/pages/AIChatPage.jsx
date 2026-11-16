import { useEffect, useState } from 'react'
import ConversationSidebar from '../components/aiChat/ConversationSidebar'
import ProjectSelector from '../components/aiChat/ProjectSelector'
import ProjectContextStatus from '../components/aiChat/ProjectContextStatus'
import ChatMessages from '../components/aiChat/ChatMessages'
import ChatInput from '../components/aiChat/ChatInput'
import SourcePreview from '../components/aiChat/SourcePreview'
import { useAIChatStore } from '../store/aiChatStore'

function AIChatPage() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const loadConversations = useAIChatStore((state) => state.loadConversations)
  const source = useAIChatStore((state) => state.source)

  useEffect(() => {
    loadConversations()
  }, [loadConversations])

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#0a0f1e]">
      {/* Header */}
      <div className="border-b border-[#232c4b] bg-[#121a2e] px-8 py-6 shadow-sm">
        <div className="mx-auto max-w-[1440px]">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#fbbf24]">Project-Aware Assistant</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#eef1f8] sm:text-4xl">AI Chat</h1>
          <p className="mt-2 max-w-2xl text-sm text-[#8f99b0] sm:text-base">
            Ask questions about your software project and explore project-aware insights.
          </p>
          <p className="mt-2 text-xs text-[#8f99b0]">
            {source === 'api' ? 'Live assistant — conversations are stored temporarily on the backend.' : 'Offline demo — chats stay in this browser.'}
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Mobile Sidebar Toggle */}
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="fixed bottom-4 right-4 z-40 rounded-lg bg-[#f59e0b] p-2 text-[#231303] lg:hidden btn-shine"
          aria-label={isSidebarOpen ? 'Close conversations' : 'Open conversations'}
        >
          ☰
        </button>

        {/* Sidebar */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-20 bg-[#05070f]/45 lg:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-30 w-64 transform bg-[#121a2e] transition-transform lg:relative lg:translate-x-0 ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <ConversationSidebar />
        </aside>

        {/* Main Chat Area */}
        <main className="flex flex-1 min-w-0 flex-col">
          <div className="flex flex-1 min-h-0 flex-col lg:flex-row gap-6 px-6 py-6">
            {/* Chat Section */}
            <div className="flex flex-1 min-w-0 flex-col">
              {/* Project Selector and Status */}
              <div className="mb-6 space-y-4">
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.1em] text-[#8f99b0]">
                    Project
                  </label>
                  <ProjectSelector />
                </div>
                <ProjectContextStatus />
              </div>

              {/* Messages Area */}
              <div className="mb-6 flex flex-1 min-h-0 flex-col rounded-xl border border-[#232c4b] bg-[#121a2e] shadow-sm">
                <ChatMessages />
              </div>

              {/* Input Area */}
              <ChatInput />
            </div>
          </div>
        </main>
      </div>

      {/* Source Preview Modal */}
      <SourcePreview />
    </section>
  )
}

export default AIChatPage
