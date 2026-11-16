import { useEffect, useState } from 'react'
import { useAIChatStore } from '../../store/aiChatStore'
import { useAuthStore } from '../../store/authStore'
import { apiFetch, isMockToken } from '../../services/api'
function ProjectContextStatus() {
  const id = useAIChatStore((s) => s.selectedProjectId)
  const token = useAuthStore((s) => s.token)
  const [state, setState] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    if (id && !isMockToken(token)) apiFetch(`/workspace/projects/${encodeURIComponent(id)}/index`, { token, signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ id, token, data }) })
      .catch((err) => { if (!controller.signal.aborted) setState({ id, token, error: err.message }) })
    return () => controller.abort()
  }, [id, token])
  const current = state?.id === id && state?.token === token ? state : null
  return <div className="rounded-lg border border-[#232c4b] bg-gradient-to-br from-[#121a2e] to-[#0a0f1e] p-4">
    <p className="text-xs font-bold uppercase tracking-[0.1em] text-[#fbbf24]">{id ? 'Repository context' : 'General chat'}</p>
    <p className="mt-3 text-xs text-[#8f99b0]">{!id ? 'No uploaded project source is sent to Gemini.' : current?.error || (current?.data ? `${current.data.indexedFiles} indexed files ? ${current.data.chunkCount} chunks ? ${current.data.pendingFiles} pending files` : 'Loading source index status...')}</p>
    {id && <p className="mt-2 text-xs text-[#8f99b0]">Keyword retrieval from your source. Name functions or identifiers for verifiable answers.</p>}
  </div>
}
export default ProjectContextStatus
