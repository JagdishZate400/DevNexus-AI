import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FileArchive,
  FileCheck,
  FileDiff,
  FilePlus,
  Info,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes, validateZipFile, workspaceApi } from '../../services/api'
import { useAuthStore } from '../../store/authStore'

const SUPPORTED_LANGUAGES_LIST = [
  'JavaScript',
  'TypeScript',
  'Python',
  'Java',
  'C',
  'C++',
  'C#',
  'Go',
  'Rust',
  'PHP',
  'HTML',
  'CSS',
  'JSON',
  'YAML',
  'SQL',
]

function mapBackendError(err) {
  if (!err) return 'An unexpected error occurred during upload.'
  const code = err.code || err.data?.code
  const message = err.message || err.data?.message || ''

  switch (code) {
    case 'archive_limit':
      return 'The ZIP archive exceeds the maximum allowed size of 50 MiB. Please reduce the archive size.'
    case 'file_limit':
      return 'A file in the archive exceeds the 1 MiB limit. Please remove oversized files and retry.'
    case 'line_limit':
      return 'A source file in the archive exceeds the maximum limit of 25,000 lines.'
    case 'expansion_ratio':
    case 'zip_bomb':
      return 'Decompression safety alert: Excessive expansion ratio or ZIP bomb detected.'
    case 'dangerous_path':
    case 'unsafe_path':
      return 'Security rejection: The archive contains unsafe paths or directory traversal attempts.'
    case 'sensitive_file':
      return 'Security rejection: The archive contains sensitive credentials (e.g., .env, private keys).'
    case 'empty_archive':
      return 'The archive contains no supported source files. Please ensure source files are present.'
    case 'corrupt_zip':
      return 'The ZIP archive is malformed or corrupted. Please verify the file integrity.'
    case 'confirmation_required':
      return 'Explicit confirmation is required before proceeding with delete-missing synchronization.'
    case 'source_storage_unavailable':
      return 'Source storage is temporarily unavailable. Please verify PostgreSQL connectivity.'
    default:
      return message || 'Upload failed. Please check your network connection and retry.'
  }
}

export default function UploadZipModal({
  projectId,
  projectName = 'Project',
  existingFilesCount = 0,
  onClose,
  onUploadSuccess,
  onIndexingComplete,
}) {
  const token = useAuthStore((s) => s.token)
  const dialogRef = useRef(null)
  const fileInputRef = useRef(null)
  const abortControllerRef = useRef(null)
  const pollTimerRef = useRef(null)

  // Form & Workflow State
  // stage: 'idle' | 'previewing' | 'preview_ready' | 'uploading' | 'indexing' | 'success' | 'error'
  const [stage, setStage] = useState('idle')
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [syncMode, setSyncMode] = useState('merge') // 'merge' (default) | 'delete_missing'
  const [confirmedDelete, setConfirmedDelete] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')

  // Upload Progress
  const [uploadProgress, setUploadProgress] = useState({ loaded: 0, total: 0, percentage: 0 })

  // Sync Preview Data
  const [previewData, setPreviewData] = useState(null)
  const [expandedPreviewTab, setExpandedPreviewTab] = useState('summary')

  // Live Indexing Progress
  const [indexingJob, setIndexingJob] = useState(null)

  // Keyboard navigation and focus trap
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && stage !== 'uploading' && stage !== 'indexing') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [stage, onClose])

  // Cleanup polling timer and upload controller on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
      if (abortControllerRef.current) abortControllerRef.current.abort()
    }
  }, [])

  // File selection validation
  const handleFileSelect = (selected) => {
    if (!selected) return
    setError('')
    setErrorCode('')
    setPreviewData(null)
    const validation = validateZipFile(selected)
    if (!validation.valid) {
      setError(validation.error)
      setFile(null)
      return
    }
    setFile(selected)
    setStage('idle')
  }

  // Drag-and-drop handlers
  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (stage === 'uploading' || stage === 'indexing') return
    const dropped = e.dataTransfer?.files?.[0]
    if (dropped) handleFileSelect(dropped)
  }

  // Generate Re-upload Sync Preview
  const handleFetchPreview = async () => {
    if (!file || stage === 'uploading' || stage === 'indexing') return
    setError('')
    setErrorCode('')
    setStage('previewing')

    try {
      const preview = await workspaceApi.previewSync(token, projectId, file, syncMode)
      setPreviewData(preview)
      setStage('preview_ready')
    } catch (err) {
      setError(mapBackendError(err))
      setErrorCode(err.code || '')
      setStage('idle')
    }
  }

  // Cancel in-flight upload
  const handleCancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStage('idle')
    setError('Upload was cancelled.')
  }

  // Start Polling for Indexing Progress
  const startPollingIndexing = () => {
    setStage('indexing')

    const poll = async () => {
      try {
        const status = await workspaceApi.indexingStatus(token, projectId)
        if (status) {
          setIndexingJob(status)

          if (status.status === 'completed') {
            setStage('success')
            if (onIndexingComplete) onIndexingComplete(status)
            return
          }

          if (status.status === 'failed') {
            setStage('error')
            setError(status.lastError ? `Indexing encountered an issue: ${status.lastError}` : 'Indexing failed.')
            return
          }
        }
      } catch (err) {
        // Tolerant to transient network glitches: retry on next cycle
        console.warn('Indexing status polling glitch (retrying):', err.message)
      }

      // Schedule next polling tick
      pollTimerRef.current = setTimeout(poll, 1500)
    }

    poll()
  }

  // Submit Upload
  const handleSubmitUpload = async (e) => {
    if (e) e.preventDefault()
    if (!file || stage === 'uploading' || stage === 'indexing') return

    if (syncMode === 'delete_missing' && !confirmedDelete) {
      setError('Please explicitly confirm deletion of missing files before continuing.')
      return
    }

    setError('')
    setErrorCode('')
    setStage('uploading')
    setUploadProgress({ loaded: 0, total: file.size, percentage: 0 })

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const uploadResult = await workspaceApi.uploadWithProgress({
        token,
        projectId,
        file,
        syncMode,
        confirmed: syncMode === 'delete_missing' ? confirmedDelete : false,
        signal: controller.signal,
        onProgress: (progress) => {
          setUploadProgress(progress)
        },
      })

      if (onUploadSuccess) onUploadSuccess(uploadResult)

      // Transition immediately to background indexing tracking
      startPollingIndexing()
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Upload was aborted.')
        setStage('idle')
        return
      }
      setError(mapBackendError(err))
      setErrorCode(err.code || '')
      setStage('idle')
    } finally {
      abortControllerRef.current = null
    }
  }

  // Retry Indexing if failed
  const handleRetryIndexing = async () => {
    setError('')
    try {
      await workspaceApi.triggerIndex(token, projectId)
      startPollingIndexing()
    } catch (err) {
      setError(err.message || 'Failed to trigger indexing retry.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#05070f]/70 p-4 backdrop-blur-sm modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
      ref={dialogRef}
    >
      <div className="modal-panel flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-[#232c4b] bg-[#121a2e] shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#1e2642] p-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-[#1a2340] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#fbbf24]">
                Multi-Language Workspace
              </span>
              <span className="text-xs text-[#8f99b0]">50 MiB Max</span>
            </div>
            <h2 id="upload-modal-title" className="mt-2 text-2xl font-bold text-[#eef1f8]">
              {existingFilesCount > 0 ? 'Synchronize Project Source' : 'Upload Project ZIP'}
            </h2>
            <p className="mt-1 text-xs text-[#8f99b0]">
              Target Project: <span className="font-semibold text-[#dbe2ef]">{projectName}</span>
            </p>
          </div>
          <button
            type="button"
            disabled={stage === 'uploading' || stage === 'indexing'}
            onClick={onClose}
            aria-label="Close upload dialog"
            className="rounded-lg p-2 text-[#8f99b0] transition-colors hover:bg-[#1a2340] hover:text-[#eef1f8] disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>

        {/* Scrollable Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* STAGE: SUCCESS */}
          {stage === 'success' ? (
            <div className="rounded-xl border border-[#065f46] bg-[#064e3b]/20 p-6 text-center animate-fade-in">
              <CheckCircle2 size={48} className="mx-auto text-[#34d399]" />
              <h3 className="mt-4 text-xl font-bold text-[#eef1f8]">Upload & Indexing Complete!</h3>
              <p className="mt-2 text-sm text-[#b9c2d6]">
                All source files have been parsed, chunked, and committed to the DevNexus AI knowledge base.
              </p>
              {indexingJob?.progress && (
                <div className="mt-5 grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
                  <div className="rounded-lg bg-[#0e1428] p-3 border border-[#232c4b]">
                    <span className="text-[11px] text-[#8f99b0]">Total Files</span>
                    <p className="text-lg font-bold text-[#eef1f8]">{indexingJob.progress.totalFiles}</p>
                  </div>
                  <div className="rounded-lg bg-[#0e1428] p-3 border border-[#232c4b]">
                    <span className="text-[11px] text-[#8f99b0]">Indexed Chunks</span>
                    <p className="text-lg font-bold text-[#34d399]">{indexingJob.progress.indexedFiles}</p>
                  </div>
                  <div className="rounded-lg bg-[#0e1428] p-3 border border-[#232c4b]">
                    <span className="text-[11px] text-[#8f99b0]">Excluded Files</span>
                    <p className="text-lg font-bold text-[#fbbf24]">{indexingJob.progress.excludedFiles || 0}</p>
                  </div>
                  <div className="rounded-lg bg-[#0e1428] p-3 border border-[#232c4b]">
                    <span className="text-[11px] text-[#8f99b0]">Coverage</span>
                    <p className="text-lg font-bold text-[#eef1f8]">100%</p>
                  </div>
                </div>
              )}
            </div>
          ) : stage === 'indexing' ? (
            /* STAGE: ASYNCHRONOUS INDEXING PROGRESS */
            <div className="rounded-xl border border-[#232c4b] bg-[#0e1428] p-6 space-y-5 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a2340] text-[#fbbf24]">
                    <Database size={20} className="animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#eef1f8]">Asynchronous Source Indexing</h3>
                    <p className="text-xs text-[#8f99b0]">Extracting code symbols and generating vector embeddings</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#1a2340] px-3 py-1 text-xs font-bold text-[#fbbf24]">
                  <Loader2 size={13} className="animate-spin text-[#fbbf24]" />
                  {indexingJob?.status === 'processing' ? 'Processing...' : 'Queued'}
                </span>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between text-xs font-medium text-[#b9c2d6] mb-2">
                  <span>Batch Indexing Progress</span>
                  <span className="font-bold text-[#fbbf24]">
                    {indexingJob?.progress?.percentage ?? 0}%
                  </span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-[#1a2340]"
                  role="progressbar"
                  aria-valuenow={indexingJob?.progress?.percentage ?? 0}
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#f59e0b] to-[#34d399] transition-all duration-300"
                    style={{ width: `${Math.max(5, indexingJob?.progress?.percentage ?? 0)}%` }}
                  />
                </div>
              </div>

              {/* Stats Counters Grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-[#121a2e] p-3 border border-[#232c4b]">
                  <span className="text-[11px] text-[#8f99b0]">Files Processed</span>
                  <p className="text-base font-bold text-[#eef1f8]">
                    {indexingJob?.progress?.processedFiles ?? 0} / {indexingJob?.progress?.totalFiles ?? '...'}
                  </p>
                </div>
                <div className="rounded-lg bg-[#121a2e] p-3 border border-[#232c4b]">
                  <span className="text-[11px] text-[#8f99b0]">Chunks Indexed</span>
                  <p className="text-base font-bold text-[#34d399]">{indexingJob?.progress?.indexedFiles ?? 0}</p>
                </div>
                <div className="rounded-lg bg-[#121a2e] p-3 border border-[#232c4b]">
                  <span className="text-[11px] text-[#8f99b0]">Current Batch</span>
                  <p className="text-base font-bold text-[#eef1f8]">
                    {indexingJob?.progress?.currentBatch ?? 1} / {indexingJob?.progress?.totalBatches ?? 1}
                  </p>
                </div>
                <div className="rounded-lg bg-[#121a2e] p-3 border border-[#232c4b]">
                  <span className="text-[11px] text-[#8f99b0]">Failed Files</span>
                  <p className="text-base font-bold text-[#f87171]">{indexingJob?.progress?.failedFiles ?? 0}</p>
                </div>
              </div>

              <p className="text-xs text-[#8f99b0] italic">
                * You may close this dialog; indexing runs durably in the background and preserves progress across backend restarts.
              </p>
            </div>
          ) : stage === 'uploading' ? (
            /* STAGE: REAL BYTE-LEVEL UPLOAD PROGRESS */
            <div className="rounded-xl border border-[#232c4b] bg-[#0e1428] p-6 space-y-5 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a2340] text-[#f59e0b]">
                    <Upload size={20} className="animate-bounce" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#eef1f8]">Uploading Archive</h3>
                    <p className="text-xs text-[#8f99b0]">{file?.name}</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-[#f59e0b]">{uploadProgress.percentage}%</span>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between text-xs text-[#8f99b0] mb-2">
                  <span>Transferred: {formatBytes(uploadProgress.loaded)}</span>
                  <span>Total: {formatBytes(uploadProgress.total || file?.size || 0)}</span>
                </div>
                <div
                  className="h-2.5 w-full overflow-hidden rounded-full bg-[#1a2340]"
                  role="progressbar"
                  aria-valuenow={uploadProgress.percentage}
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  <div
                    className="h-full rounded-full bg-[#f59e0b] transition-all duration-150"
                    style={{ width: `${uploadProgress.percentage}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={handleCancelUpload}
                  className="rounded-lg border border-[#3b4261] px-4 py-2 text-xs font-bold text-[#b9c2d6] hover:bg-[#1a2340]"
                >
                  Cancel Upload
                </button>
              </div>
            </div>
          ) : (
            /* STAGE: FILE SELECTION, SYNC OPTIONS & PREVIEW */
            <div className="space-y-5">
              {/* Drop Zone */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                  isDragging
                    ? 'border-[#fbbf24] bg-[#1a2340]'
                    : file
                    ? 'border-[#059669] bg-[#064e3b]/10'
                    : 'border-[#2b3558] bg-[#0e1428] hover:border-[#3b4774] hover:bg-[#121a2e]'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,application/zip,application/x-zip-compressed"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />

                {file ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-left">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#1a2340] text-[#34d399]">
                        <FileArchive size={24} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-[#eef1f8] truncate max-w-sm">{file.name}</p>
                        <p className="text-xs text-[#8f99b0]">{formatBytes(file.size)} ? Ready for ingestion</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setFile(null)
                        setPreviewData(null)
                      }}
                      className="rounded-lg p-2 text-[#8f99b0] hover:bg-[#1a2340] hover:text-[#f87171]"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ) : (
                  <div>
                    <FileArchive className="mx-auto text-[#fbbf24]" size={36} />
                    <p className="mt-3 text-sm font-bold text-[#eef1f8]">
                      Drop your ZIP archive here, or <span className="text-[#fbbf24]">browse files</span>
                    </p>
                    <p className="mt-1 text-xs text-[#8f99b0]">
                      Standard .zip archives up to 50 MiB (maximum 1,000 files, 1 MiB per file)
                    </p>
                  </div>
                )}
              </div>

              {/* Supported Languages Pills */}
              <div className="rounded-xl border border-[#1e2642] bg-[#0a0f1e] p-4">
                <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8f99b0]">
                  15 Supported Language Categories
                </span>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {SUPPORTED_LANGUAGES_LIST.map((lang) => (
                    <span
                      key={lang}
                      className="rounded-md bg-[#121a2e] border border-[#232c4b] px-2 py-0.5 text-[11px] font-medium text-[#b9c2d6]"
                    >
                      {lang}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-[#6b7696]">
                  Dependencies (node_modules, vendor), build directories, and Git metadata are automatically excluded.
                </p>
              </div>

              {/* Re-Upload Synchronization Mode (Shown when files exist or file selected) */}
              {existingFilesCount > 0 && (
                <div className="rounded-xl border border-[#232c4b] bg-[#0e1428] p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#eef1f8] flex items-center gap-2">
                      <RefreshCw size={15} className="text-[#fbbf24]" />
                      Incremental Re-Upload Synchronization
                    </h3>
                    <span className="text-xs text-[#8f99b0]">{existingFilesCount} existing files</span>
                  </div>

                  <div className="space-y-3">
                    {/* Mode 1: Merge (Default) */}
                    <label
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                        syncMode === 'merge'
                          ? 'border-[#fbbf24] bg-[#1a2340]/40'
                          : 'border-[#232c4b] bg-[#121a2e] hover:border-[#3b4774]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="syncMode"
                        value="merge"
                        checked={syncMode === 'merge'}
                        onChange={() => {
                          setSyncMode('merge')
                          setConfirmedDelete(false)
                        }}
                        className="mt-0.5 accent-[#fbbf24]"
                      />
                      <div>
                        <p className="text-xs font-bold text-[#eef1f8]">
                          Non-Destructive Merge <span className="ml-1 text-[10px] text-[#34d399]">(Recommended)</span>
                        </p>
                        <p className="mt-0.5 text-xs text-[#8f99b0]">
                          Updates modified files and adds new files. Files missing from this ZIP are preserved intact.
                        </p>
                      </div>
                    </label>

                    {/* Mode 2: Delete Missing (Requires explicit confirmation) */}
                    <label
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                        syncMode === 'delete_missing'
                          ? 'border-[#f87171] bg-[#7f1d1d]/10'
                          : 'border-[#232c4b] bg-[#121a2e] hover:border-[#3b4774]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="syncMode"
                        value="delete_missing"
                        checked={syncMode === 'delete_missing'}
                        onChange={() => setSyncMode('delete_missing')}
                        className="mt-0.5 accent-[#f87171]"
                      />
                      <div>
                        <p className="text-xs font-bold text-[#f87171]">
                          Full Mirror Synchronization (Delete Missing)
                        </p>
                        <p className="mt-0.5 text-xs text-[#8f99b0]">
                          Permanently removes any files from this project that do not exist in the uploaded archive.
                        </p>
                      </div>
                    </label>

                    {/* Warning & Confirmation Checkbox for Delete Missing */}
                    {syncMode === 'delete_missing' && (
                      <div className="rounded-lg border border-[#f87171]/40 bg-[#7f1d1d]/20 p-3.5 text-xs space-y-2 animate-fade-in">
                        <div className="flex items-center gap-2 text-[#f87171] font-bold">
                          <AlertTriangle size={15} />
                          Permanent File Removal Warning
                        </div>
                        <p className="text-[#fca5a5]">
                          Deleted files cannot be recovered. Code review history and conversation links referencing deleted files will be preserved safely.
                        </p>
                        <label className="flex items-center gap-2.5 pt-1 cursor-pointer font-bold text-[#eef1f8]">
                          <input
                            type="checkbox"
                            checked={confirmedDelete}
                            onChange={(e) => setConfirmedDelete(e.target.checked)}
                            className="rounded border-[#f87171] accent-[#f87171]"
                          />
                          I understand that missing files will be permanently deleted
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Sync Preview Button */}
                  {file && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={handleFetchPreview}
                        disabled={stage === 'previewing'}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#2b3558] bg-[#1a2340] px-3.5 py-2 text-xs font-bold text-[#b9c2d6] hover:bg-[#232c4b] disabled:opacity-50"
                      >
                        {stage === 'previewing' ? (
                          <>
                            <Loader2 size={14} className="animate-spin text-[#fbbf24]" />
                            Analyzing ZIP Archive...
                          </>
                        ) : (
                          <>
                            <FileDiff size={14} className="text-[#fbbf24]" />
                            Analyze & Preview Sync Changes
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Sync Preview Results Breakdown */}
              {previewData?.summary && (
                <div className="rounded-xl border border-[#232c4b] bg-[#0e1428] p-5 space-y-4 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[#eef1f8]">Synchronization Preview</h3>
                    <span className="text-xs text-[#8f99b0]">
                      {previewData.uploadCount} files in ZIP vs {previewData.existingCount} existing
                    </span>
                  </div>

                  {/* Summary Pills */}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-center">
                    <button
                      type="button"
                      onClick={() => setExpandedPreviewTab('added')}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        expandedPreviewTab === 'added' ? 'border-[#34d399] bg-[#064e3b]/30' : 'border-[#232c4b] bg-[#121a2e]'
                      }`}
                    >
                      <span className="text-[10px] text-[#8f99b0] uppercase">New Files</span>
                      <p className="text-base font-bold text-[#34d399]">+{previewData.summary.added}</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedPreviewTab('updated')}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        expandedPreviewTab === 'updated' ? 'border-[#38bdf8] bg-[#0284c7]/20' : 'border-[#232c4b] bg-[#121a2e]'
                      }`}
                    >
                      <span className="text-[10px] text-[#8f99b0] uppercase">Modified</span>
                      <p className="text-base font-bold text-[#38bdf8]">~{previewData.summary.updated}</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedPreviewTab('unchanged')}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        expandedPreviewTab === 'unchanged' ? 'border-[#b9c2d6] bg-[#1a2340]' : 'border-[#232c4b] bg-[#121a2e]'
                      }`}
                    >
                      <span className="text-[10px] text-[#8f99b0] uppercase">Unchanged</span>
                      <p className="text-base font-bold text-[#b9c2d6]">={previewData.summary.unchanged}</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedPreviewTab('missing')}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        expandedPreviewTab === 'missing' ? 'border-[#f87171] bg-[#7f1d1d]/20' : 'border-[#232c4b] bg-[#121a2e]'
                      }`}
                    >
                      <span className="text-[10px] text-[#8f99b0] uppercase">Missing</span>
                      <p className="text-base font-bold text-[#f87171]">
                        {syncMode === 'delete_missing' ? `-${previewData.summary.removed}` : `=${previewData.summary.preserved}`}
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setExpandedPreviewTab('excluded')}
                      className={`rounded-lg border p-2.5 transition-colors ${
                        expandedPreviewTab === 'excluded' ? 'border-[#fbbf24] bg-[#b45309]/20' : 'border-[#232c4b] bg-[#121a2e]'
                      }`}
                    >
                      <span className="text-[10px] text-[#8f99b0] uppercase">Excluded</span>
                      <p className="text-base font-bold text-[#fbbf24]">⊘{previewData.summary.excluded || 0}</p>
                    </button>
                  </div>

                  {/* Collapsible File List */}
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-[#1e2642] bg-[#0a0f1e] p-3 text-xs font-mono">
                    {expandedPreviewTab === 'added' && (
                      <div>
                        <p className="text-[11px] font-bold text-[#34d399] mb-1">New Files to be Added:</p>
                        {previewData.addedFiles?.length ? (
                          previewData.addedFiles.map((p) => <p key={p} className="text-[#b9c2d6]">+ {p}</p>)
                        ) : (
                          <p className="text-[#8f99b0] italic">No new files.</p>
                        )}
                      </div>
                    )}
                    {expandedPreviewTab === 'updated' && (
                      <div>
                        <p className="text-[11px] font-bold text-[#38bdf8] mb-1">Modified Files to be Updated:</p>
                        {previewData.updatedFiles?.length ? (
                          previewData.updatedFiles.map((p) => <p key={p} className="text-[#b9c2d6]">~ {p}</p>)
                        ) : (
                          <p className="text-[#8f99b0] italic">No modified files.</p>
                        )}
                      </div>
                    )}
                    {expandedPreviewTab === 'unchanged' && (
                      <div>
                        <p className="text-[11px] font-bold text-[#b9c2d6] mb-1">Identical Files (Skipped from indexing):</p>
                        {previewData.unchangedFiles?.length ? (
                          previewData.unchangedFiles.map((p) => <p key={p} className="text-[#8f99b0]">= {p}</p>)
                        ) : (
                          <p className="text-[#8f99b0] italic">No unchanged files.</p>
                        )}
                      </div>
                    )}
                    {expandedPreviewTab === 'missing' && (
                      <div>
                        <p className="text-[11px] font-bold text-[#f87171] mb-1">
                          {syncMode === 'delete_missing' ? 'Files to be Deleted:' : 'Missing Files to be Kept:'}
                        </p>
                        {(syncMode === 'delete_missing' ? previewData.removedFiles : previewData.preservedFiles)?.length ? (
                          (syncMode === 'delete_missing' ? previewData.removedFiles : previewData.preservedFiles).map((p) => (
                            <p key={p} className="text-[#b9c2d6]">{syncMode === 'delete_missing' ? `- ${p}` : `✓ ${p}`}</p>
                          ))
                        ) : (
                          <p className="text-[#8f99b0] italic">No missing files.</p>
                        )}
                      </div>
                    )}
                    {expandedPreviewTab === 'excluded' && (
                      <div>
                        <p className="text-[11px] font-bold text-[#fbbf24] mb-1">Ignored Entries (Dependencies/Build):</p>
                        {previewData.excludedFiles?.length ? (
                          previewData.excludedFiles.map((p) => <p key={p} className="text-[#8f99b0]">⊘ {p}</p>)
                        ) : (
                          <p className="text-[#8f99b0] italic">No excluded entries.</p>
                        )}
                      </div>
                    )}
                    {expandedPreviewTab === 'summary' && (
                      <p className="text-[#8f99b0] italic">
                        Select a category badge above to inspect individual file paths.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Validation Error Banner */}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-[#f87171]/40 bg-[#7f1d1d]/20 p-4 text-xs text-[#fca5a5] animate-fade-in"
            >
              <AlertCircle size={18} className="text-[#f87171] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold text-[#f87171]">Validation or Upload Error</p>
                <p>{error}</p>
                {stage === 'error' && (
                  <button
                    type="button"
                    onClick={handleRetryIndexing}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[#1a2340] px-3 py-1 font-bold text-[#fbbf24] hover:bg-[#232c4b]"
                  >
                    <RefreshCw size={12} /> Retry Indexing
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="flex items-center justify-between border-t border-[#1e2642] p-6 bg-[#0e1428]/50 rounded-b-2xl">
          <button
            type="button"
            disabled={stage === 'uploading' || stage === 'indexing'}
            onClick={onClose}
            className="rounded-lg border border-[#2b3558] bg-[#121a2e] px-4 py-2.5 text-xs font-bold text-[#b9c2d6] hover:bg-[#1a2340] disabled:opacity-40"
          >
            {stage === 'success' ? 'Close' : 'Cancel'}
          </button>

          {stage === 'success' ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg bg-[#34d399] px-5 py-2.5 text-xs font-bold text-[#064e3b] hover:bg-[#6ee7b7]"
            >
              <CheckCircle2 size={16} /> Explore Workspace Files
            </button>
          ) : stage === 'indexing' ? (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-[#2b3558] bg-[#1a2340] px-4 py-2.5 text-xs font-bold text-[#fbbf24]"
            >
              Close & Run in Background
            </button>
          ) : (
            <button
              type="button"
              disabled={
                !file ||
                stage === 'uploading' ||
                stage === 'previewing' ||
                (syncMode === 'delete_missing' && !confirmedDelete)
              }
              onClick={handleSubmitUpload}
              className="inline-flex items-center gap-2 rounded-lg bg-[#f59e0b] px-5 py-2.5 text-xs font-bold text-[#231303] hover:bg-[#fbbf24] btn-shine disabled:opacity-50"
            >
              {stage === 'uploading' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Uploading {uploadProgress.percentage}%...
                </>
              ) : existingFilesCount > 0 ? (
                <>
                  <RefreshCw size={15} />
                  Synchronize Project Source
                </>
              ) : (
                <>
                  <Upload size={15} />
                  Upload & Index Project
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
