import { useEffect, useMemo, useState } from 'react'
import CodeViewer from '../components/workspace/CodeViewer'
import FileInfo from '../components/workspace/FileInfo'
import FileTree from '../components/workspace/FileTree'
import ProjectSelector from '../components/workspace/ProjectSelector'
import IndexingStatusBanner from '../components/workspace/IndexingStatusBanner'
import UploadPlaceholderModal from '../components/workspace/UploadPlaceholderModal'
import WorkspaceHeader from '../components/workspace/WorkspaceHeader'
import { workspaceApi, isMockToken } from '../services/api'
import { useAuthStore } from '../store/authStore'

function buildTree(files) {
  const tree = []
  for (const file of files) {
    let children = tree
    const parts = file.path.split('/')
    parts.forEach((name, index) => {
      if (index === parts.length - 1) children.push({ ...file, name, type: 'file' })
      else {
        let folder = children.find((node) => node.name === name && node.type === 'folder')
        if (!folder) { folder = { name, type: 'folder', children: [] }; children.push(folder) }
        children = folder.children
      }
    })
  }
  return tree
}
function folderPaths(files) {
  return new Set(files.flatMap((f) => f.path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))
}
function WorkspaceContent({ token }) {
  const [projects, setProjects] = useState([])
  const [projectId, setProjectId] = useState('')
  const [files, setFiles] = useState([])
  const [fileId, setFileId] = useState('')
  const [activeFile, setActiveFile] = useState(null)
  const [expandedFolders, setExpandedFolders] = useState(new Set())
  const [uploadOpen, setUploadOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const project = projects.find((p) => p.id === projectId) || { name: 'No project selected' }
  const tree = useMemo(() => buildTree(files), [files])
  const folders = useMemo(() => folderPaths(files), [files])
  useEffect(() => {
    const controller = new AbortController()
    Promise.resolve().then(async () => {
      if (controller.signal.aborted) return
      if (isMockToken(token)) throw new Error('Sign in to upload and browse your project source.')
      setLoading(true)
      return workspaceApi.projects(token, controller.signal)
    }).then((data) => {
      if (controller.signal.aborted) return
      setProjects(data.projects); setProjectId(data.projects[0]?.id || '')
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token])
  useEffect(() => {
    const controller = new AbortController()
    if (!projectId) return
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return
      setFiles([]); setFileId(''); setActiveFile(null); setError(''); setLoading(true)
      return workspaceApi.files(token, projectId, controller.signal)
    }).then((data) => {
      if (controller.signal.aborted) return
      setFiles(data.files); setExpandedFolders(folderPaths(data.files))
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token, projectId, revision])
  useEffect(() => {
    const controller = new AbortController()
    if (!fileId || !projectId) return
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return
      setActiveFile(null); setError(''); setReading(true)
      return workspaceApi.read(token, projectId, fileId, controller.signal)
    }).then((data) => {
      if (controller.signal.aborted) return
      const { file } = data
      setActiveFile({ ...file, name: file.path.split('/').at(-1), size: `${file.byteSize} bytes`, updated: new Date(file.uploadedAt).toLocaleString() })
    }).catch((err) => { if (!controller.signal.aborted) setError(err.message) })
      .finally(() => { if (!controller.signal.aborted) setReading(false) })
    return () => controller.abort()
  }, [token, projectId, fileId])
  function toggleFolder(path) {
    setExpandedFolders((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })
  }
  function changeProject(id) { setProjectId(id); setFiles([]); setFileId(''); setActiveFile(null); setReading(false); setMessage(''); setUploadOpen(false) }
  return <section className="mx-auto w-full max-w-[1440px] min-w-0 px-5 py-8 sm:px-8 lg:py-10">
    <WorkspaceHeader project={project} onUpload={() => setUploadOpen(true)} onRefresh={() => setRevision((n) => n + 1)} disabled={!projectId || loading} />
    {error && <p role="alert" className="mt-4 text-sm text-[#f87171]">{error}</p>}
    {message && <p role="status" className="mt-4 text-sm text-[#34d399]">{message}</p>}
    {loading && <p role="status" className="mt-4 text-sm text-[#8f99b0]">Loading source workspace...</p>}
    {!loading && !error && !projects.length && <p className="mt-4 text-sm text-[#8f99b0]">Create a project in Projects first, then return here to upload source.</p>}
    {projectId && !loading && !error && (
      <div className="mt-6">
        <IndexingStatusBanner projectId={projectId} onIndexComplete={() => setRevision((n) => n + 1)} />
      </div>
    )}
    <div className="mt-7 grid min-w-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="min-w-0 rounded-xl border border-[#232c4b] bg-[#121a2e]">
        <div className="p-4"><ProjectSelector projects={projects} selectedProjectId={projectId} onChange={changeProject} disabled={uploadOpen} /></div>
        <FileTree tree={tree} expandedFolders={expandedFolders} onToggle={toggleFolder} selectedFile={activeFile} onSelect={(file) => { setActiveFile(null); setFileId(file.id) }} />
        {!loading && projectId && !files.length && <p className="p-4 text-xs text-[#8f99b0]">No source files uploaded yet.</p>}
      </aside>
      <section className="min-w-0 overflow-hidden rounded-xl border border-[#232c4b] bg-[#121a2e]">
        <FileInfo file={activeFile} />
        {reading ? <p role="status" className="p-6 text-sm text-[#8f99b0]">Loading source file...</p> : <CodeViewer file={activeFile} />}
      </section>
    </div>
    <section className="mt-6 rounded-xl border border-[#232c4b] bg-[#121a2e] p-5">
      <h3 className="font-bold text-[#dbe2ef]">Project Structure</h3>
      <p className="mt-3 text-sm text-[#8f99b0]">{loading || error ? 'Source metadata is not currently available.' : `${files.length} stored files ? ${folders.size} directories ? ${files.reduce((sum, file) => sum + file.byteSize, 0)} bytes`}</p>
      <p className="mt-3 text-xs text-[#8f99b0]">Supports up to 50 MiB ZIP archives across 15 language categories. Source files are parsed, chunked, and asynchronously indexed for AI Chat, Code Review, and Documentation.</p>
    </section>
    {uploadOpen && (
      <UploadPlaceholderModal
        key={projectId}
        projectId={projectId}
        projectName={project?.name}
        existingFilesCount={files.length}
        onClose={() => setUploadOpen(false)}
        onUploadSuccess={(data) => {
          setMessage(`Saved ${data.uploadedFiles} source files (${data.uploadedBytes} bytes).`)
          setRevision((n) => n + 1)
        }}
        onIndexingComplete={() => {
          setRevision((n) => n + 1)
        }}
        onUpload={async (zip) => {
          const data = await workspaceApi.upload(token, projectId, zip)
          setMessage(`Saved ${data.uploadedFiles} source files (${data.uploadedBytes} bytes).`)
          setRevision((n) => n + 1)
          return data
        }}
      />
    )}
  </section>
}
export default function WorkspacePage() {
  const token = useAuthStore((s) => s.token)
  return <WorkspaceContent key={token || 'signed-out'} token={token} />
}
