import {
  AlertCircle,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isMockToken, workspaceApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'

export default function IndexingStatusBanner({ projectId, onIndexComplete }) {
  const token = useAuthStore((s) => s.token)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [error, setError] = useState('')
  const pollTimerRef = useRef(null)

  // Fetch index stats and active job status
  const loadStatus = async (isPolling = false) => {
    if (!projectId || isMockToken(token)) return
    if (!isPolling) setLoading(true)

    try {
      const data = await workspaceApi.indexStats(token, projectId)
      setStats(data)
      setError('')

      const isWorking =
        data.job?.status === 'processing' ||
        data.job?.status === 'pending' ||
        data.pendingFiles > 0

      if (isWorking) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
        pollTimerRef.current = setTimeout(() => loadStatus(true), 2000)
      } else if (isPolling && data.job?.status === 'completed') {
        if (onIndexComplete) onIndexComplete()
      }
    } catch (err) {
      if (!isPolling) setError(err.message || 'Failed to load index status.')
    } finally {
      if (!isPolling) setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus(false)
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [projectId, token])

  // Manual Trigger Re-index
  const handleTriggerReindex = async () => {
    if (!projectId || triggering || isMockToken(token)) return
    setTriggering(true)
    setError('')
    try {
      await workspaceApi.triggerIndex(token, projectId)
      await loadStatus(true)
    } catch (err) {
      setError(err.message || 'Failed to trigger indexing.')
    } finally {
      setTriggering(false)
    }
  }

  if (!projectId || isMockToken(token)) return null

  const isWorking =
    stats?.job?.status === 'processing' ||
    stats?.job?.status === 'pending' ||
    (stats && stats.pendingFiles > 0)

  const progressPercentage =
    stats?.job?.progress?.percentage ??
    (stats?.totalFiles ? Math.round((stats.indexedFiles / stats.totalFiles) * 100) : 0)

  return (
    <div className="rounded-xl border border-[#232c4b] bg-gradient-to-r from-[#121a2e] to-[#0e1428] p-4 text-xs">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${
              isWorking
                ? 'bg-[#fbbf24]/10 text-[#fbbf24]'
                : stats?.isIndexed
                ? 'bg-[#34d399]/10 text-[#34d399]'
                : 'bg-[#1a2340] text-[#8f99b0]'
            }`}
          >
            {isWorking ? (
              <Loader2 size={18} className="animate-spin text-[#fbbf24]" />
            ) : stats?.isIndexed ? (
              <CheckCircle2 size={18} className="text-[#34d399]" />
            ) : (
              <Database size={18} />
            )}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#eef1f8]">
                {isWorking ? 'Indexing in Progress' : 'AI Knowledge Base Status'}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  isWorking
                    ? 'bg-[#fbbf24]/20 text-[#fbbf24]'
                    : stats?.isIndexed
                    ? 'bg-[#064e3b] text-[#34d399]'
                    : 'bg-[#1a2340] text-[#8f99b0]'
                }`}
              >
                {isWorking
                  ? `${progressPercentage}%`
                  : stats?.isIndexed
                  ? 'Indexed'
                  : 'Pending'}
              </span>
            </div>

            <p className="mt-0.5 text-[11px] text-[#8f99b0]">
              {loading
                ? 'Loading index status...'
                : stats
                ? `${stats.indexedFiles} indexed files · ${stats.chunkCount || 0} chunks · ${stats.pendingFiles} pending`
                : 'Status not available'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isWorking || triggering}
            onClick={handleTriggerReindex}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#2b3558] bg-[#1a2340] px-3 py-1.5 text-[11px] font-bold text-[#b9c2d6] hover:bg-[#232c4b] disabled:opacity-40"
          >
            <RefreshCw size={12} className={triggering ? 'animate-spin' : ''} />
            {isWorking ? 'Indexing...' : 'Re-index Project'}
          </button>
        </div>
      </div>

      {/* Progress Bar (Visible during active indexing) */}
      {isWorking && (
        <div className="mt-3">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-[#1a2340]"
            role="progressbar"
            aria-valuenow={progressPercentage}
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#f59e0b] to-[#34d399] transition-all duration-300"
              style={{ width: `${Math.max(5, progressPercentage)}%` }}
            />
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#f87171]">
          <AlertCircle size={13} />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
