import { useState } from 'react'
import { Send } from 'lucide-react'
import { useAIChatStore } from '../../store/aiChatStore'
import { suggestedQuestions } from '../../data/aiChatData'

function ChatInput() {
  const { sendMessage, selectedConversationId, selectedProjectId, createNewConversation, loadError } = useAIChatStore()
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sendError, setSendError] = useState('')
  const questions = suggestedQuestions[selectedProjectId] || []

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const text = input
    setInput('')
    setIsLoading(true)
    setSendError('')
    try {
      // Ensure a conversation is selected (server or local).
      let conversationId = selectedConversationId
      if (!conversationId) {
        const created = await createNewConversation(selectedProjectId)
        conversationId = created.id
      }
      await sendMessage(conversationId, text)
    } catch (err) {
      setInput(text)
      setSendError(err.message || 'Could not send the message.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSuggestedQuestion = (question) => {
    setInput(question)
  }

  return (
    <div className="border-t border-[#232c4b] bg-[#121a2e] p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* Input Area */}
        <div className="flex gap-3">
          <input
            type="text"
            maxLength={4000}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder="Ask about your project..."
            className="flex-1 rounded-lg border border-[#232c4b] bg-[#121a2e] px-4 py-3 text-sm text-[#eef1f8] placeholder-[#8f99b0] focus:outline-none focus:ring-2 focus:ring-[#f59e0b] disabled:bg-[#0a0f1e]"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="btn-press btn-shine flex items-center gap-2 rounded-lg bg-[#f59e0b] px-4 py-3 text-sm font-semibold text-[#231303] hover:bg-[#fbbf24] disabled:bg-[#8f99b0]"
          >
            <Send size={16} />
            Send
          </button>
        </div>

        {/* Quick suggestions */}
        {(sendError || loadError) && (
          <p role="alert" className="text-xs font-medium text-[#f87171]">{sendError || loadError}</p>
        )}
        {!isLoading && questions.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#8f99b0]">Quick questions:</p>
            <div className="animate-stagger flex flex-wrap gap-2">
              {questions.slice(0, 3).map((question, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSuggestedQuestion(question)}
                  className="rounded-full border border-[#232c4b] bg-[#121a2e] px-3 py-1.5 text-xs text-[#34d399] transition-all hover:-translate-y-0.5 hover:border-[#34d399] hover:bg-[#1a2340]"
                >
                  {question.substring(0, 30)}...
                </button>
              ))}
            </div>
          </div>
        )}
      </form>
    </div>
  )
}

export default ChatInput
