import { useEffect, useRef } from 'react'
import { useAIChatStore } from '../../store/aiChatStore'
import MessageBubble from './MessageBubble'
import SuggestedQuestions from './SuggestedQuestions'

function ChatMessages() {
  const { conversations, selectedConversationId } = useAIChatStore()
  const messagesEndRef = useRef(null)
  const containerRef = useRef(null)
  const conversation = conversations.find((c) => c.id === selectedConversationId)

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' })
  }

  useEffect(() => {
    scrollToBottom(false)
  }, [selectedConversationId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100
    if (nearBottom) {
      scrollToBottom()
    }
  }, [conversation?.messages])

  if (!conversation) {
    return <div className="flex items-center justify-center py-8 text-[#8f99b0]">No conversation selected</div>
  }

  const isEmpty = conversation.messages.length === 0

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-y-auto">
      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-12 text-center">
          <h3 className="mb-2 text-2xl font-bold text-[#eef1f8]">Ask your project anything</h3>
          <p className="mb-8 max-w-md text-sm text-[#8f99b0]">
            Select your uploaded project for answers grounded in retrieved source, or choose general chat.
          </p>
          <SuggestedQuestions />
        </div>
      ) : (
        <>
          <div className="space-y-6 px-6 py-8">
            {conversation.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  )
}

export default ChatMessages
