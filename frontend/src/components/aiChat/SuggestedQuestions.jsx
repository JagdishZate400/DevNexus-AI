import { useAIChatStore } from '../../store/aiChatStore'
import { suggestedQuestions } from '../../data/aiChatData'

function SuggestedQuestions({ onSelectQuestion }) {
  const { selectedProjectId } = useAIChatStore()
  const questions = suggestedQuestions[selectedProjectId] || []

  return (
    <div className="animate-stagger grid w-full max-w-2xl gap-3 sm:grid-cols-2">
      {questions.slice(0, 4).map((question, idx) => (
        <button
          key={idx}
          onClick={() => onSelectQuestion && onSelectQuestion(question)}
          className="rounded-lg border border-[#232c4b] bg-[#121a2e] px-4 py-3 text-left text-sm font-medium text-[#eef1f8] transition-all hover:-translate-y-0.5 hover:border-[#34d399] hover:bg-[#0a0f1e] hover:shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        >
          {question}
        </button>
      ))}
    </div>
  )
}

export default SuggestedQuestions
