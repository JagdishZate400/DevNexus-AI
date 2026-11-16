import { X, ExternalLink } from 'lucide-react'
import { useAIChatStore } from '../../store/aiChatStore'
import { mockSourceFiles } from '../../data/aiChatData'

function SourcePreview() {
  const { selectedSourcePath, setSelectedSourcePath } = useAIChatStore()

  if (!selectedSourcePath) return null

  const realSource = typeof selectedSourcePath === 'object' && selectedSourcePath !== null
  const sourceFile = realSource ? selectedSourcePath : mockSourceFiles[selectedSourcePath]

  if (!sourceFile) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
        <div className="rounded-lg bg-[#121a2e] p-6 text-center">
          <p className="text-[#8f99b0]">Source file not found</p>
          <button
            onClick={() => setSelectedSourcePath(null)}
            className="mt-4 rounded bg-[#f59e0b] px-4 py-2 text-[#231303] hover:bg-[#fbbf24] btn-shine"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg bg-[#121a2e] shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#232c4b] bg-[#121a2e] px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#eef1f8]">{sourceFile.path.split('/').pop()}</h2>
            <p className="mt-1 text-xs text-[#8f99b0]">{sourceFile.path}</p>
            <div className="mt-2 flex gap-2">
              <span className="inline-flex items-center rounded-full bg-[#1a2340] px-2 py-1 text-xs font-medium text-[#34d399]">
                {sourceFile.language}
              </span>
            </div>
          </div>
          <button
            onClick={() => setSelectedSourcePath(null)}
            className="rounded p-1 text-[#8f99b0] hover:bg-[#232c4b] hover:text-[#eef1f8]"
          >
            <X size={20} />
          </button>
        </div>

        {/* Code Content */}
        <div className="overflow-auto bg-[#0b1120]">
          <pre className="p-6 font-mono text-sm text-[#d5dbea]">
            <code>
              {sourceFile.snippet.split('\n').map((line, idx) => (
                <div key={idx} className="flex gap-4">
                  <span className="inline-block w-8 flex-shrink-0 text-right text-[#8f99b0]">{(sourceFile.startLine || 1) + idx}</span>
                  <span>{line}</span>
                </div>
              ))}
            </code>
          </pre>
        </div>

        {/* Footer */}
        <div className="border-t border-[#232c4b] bg-[#121a2e] px-6 py-4 flex items-center justify-between">
          <p className="text-xs text-[#8f99b0]">{realSource ? `Retrieved source chunk - lines ${sourceFile.startLine}-${sourceFile.endLine}${sourceFile.startColumn ? ` - columns ${sourceFile.startColumn}-${sourceFile.endColumn}` : ''}` : 'Mock source code snippet for demonstration'}</p>
          <button
            onClick={() => {
              setSelectedSourcePath(null)
              if (realSource) window.location.assign('/workspace')
            }}
            className="inline-flex items-center gap-2 rounded bg-[#f59e0b] px-3 py-2 text-sm font-medium text-[#231303] hover:bg-[#fbbf24] btn-shine"
          >
            <ExternalLink size={14} />
            Open in Workspace
          </button>
        </div>
      </div>
    </div>
  )
}

export default SourcePreview
