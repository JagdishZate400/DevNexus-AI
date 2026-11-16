import {generationPayload} from '../data/documentationRequests.js'
const baseUrl = ((typeof import.meta.env !== 'undefined' && import.meta.env.VITE_API_URL) || 'http://localhost:5001/api').replace(/\/$/, '')

// Refresh hook wiring (registered by the auth store). Lets one 401 on an
// authenticated call attempt a single silent refresh + retry instead of
// forcing the user back to login the moment the access token expires.
let refreshHandler = null
export function setRefreshHandler(handler) {
  refreshHandler = handler
}

export async function apiFetch(path, { method = 'GET', body, rawBody, token, _retried, signal } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': rawBody ? 'application/zip' : 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: rawBody || (body ? JSON.stringify(body) : undefined),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && token && refreshHandler && !_retried) {
    // Authenticated call, access token rejected: try one silent refresh.
    const freshToken = await refreshHandler().catch(() => null)
    if (freshToken) {
      return apiFetch(path, { method, body, rawBody, token: freshToken, _retried: true, signal })
    }
  }
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export const authApi = {
  login: (payload) => apiFetch('/auth/login', { method: 'POST', body: payload }),
  register: (payload) => apiFetch('/auth/register', { method: 'POST', body: payload }),
  requestCode: (payload) => apiFetch('/auth/request-code', { method: 'POST', body: payload }),
  verifyCode: (payload) => apiFetch('/auth/verify-code', { method: 'POST', body: payload }),
  me: (token) => apiFetch('/auth/me', { token }),
  refresh: (refreshToken) => apiFetch('/auth/refresh', { method: 'POST', body: { refreshToken } }),
  logout: (payload, token) => apiFetch('/auth/logout', { method: 'POST', body: payload || {}, ...(token ? { token } : {}) }),
  forgotPassword: (payload) => apiFetch('/auth/forgot-password', { method: 'POST', body: payload }),
  resetPassword: (payload) => apiFetch('/auth/reset-password', { method: 'POST', body: payload }),
  changePassword: (token, payload) => apiFetch('/auth/change-password', { method: 'POST', body: payload, token }),
}

export const projectsApi = {
  list: (token) => apiFetch('/projects', { token }),
  create: (token, payload) => apiFetch('/projects', { method: 'POST', body: payload, token }),
  get: (token, id) => apiFetch(`/projects/${encodeURIComponent(id)}`, { token }),
  update: (token, id, payload) =>
    apiFetch(`/projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, token }),
  remove: (token, id) => apiFetch(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
}

export const tasksApi = {
  list: (token) => apiFetch('/tasks?limit=100', { token }),
  create: (token, payload) => apiFetch('/tasks', { method: 'POST', body: payload, token }),
  update: (token, id, payload) =>
    apiFetch(`/tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, token }),
  remove: (token, id) => apiFetch(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
}

// Durable owner-scoped tasks; keep legacy tasksApi/store consumers separate.
export const projectTasksApi = {
  list: (token, projectId, offset = 0, signal) => apiFetch(`/project-tasks?projectId=${encodeURIComponent(projectId)}&limit=20&offset=${offset}`, { token, signal: signal || AbortSignal.timeout(15000) }),
  create: (token, payload) => apiFetch('/project-tasks', { method: 'POST', token, body: payload, _retried: true, signal: AbortSignal.timeout(15000) }),
  update: (token, id, payload) => apiFetch(`/project-tasks/${encodeURIComponent(id)}`, { method: 'PATCH', token, body: payload, _retried: true, signal: AbortSignal.timeout(15000) }),
  remove: (token, id) => apiFetch(`/project-tasks/${encodeURIComponent(id)}`, { method: 'DELETE', token, signal: AbortSignal.timeout(15000) }),
}

// Durable sprint operations stay separate from legacy Dashboard/Reports APIs.
export const projectSprintsApi = {
  list: (token, projectId, offset=0, signal) => apiFetch(`/project-sprints?projectId=${encodeURIComponent(projectId)}&limit=20&offset=${offset}`, {token,signal:signal || AbortSignal.timeout(15000)}),
  create: (token, body) => apiFetch('/project-sprints', {token,method:'POST',body,_retried:true,signal:AbortSignal.timeout(15000)}),
  read: (token,id,signal) => apiFetch(`/project-sprints/${encodeURIComponent(id)}`, {token,signal:signal || AbortSignal.timeout(15000)}),
  update: (token,id,body) => apiFetch(`/project-sprints/${encodeURIComponent(id)}`, {token,method:'PATCH',body,signal:AbortSignal.timeout(15000)}),
  tasks: (token,id,offset=0,signal) => apiFetch(`/project-sprints/${encodeURIComponent(id)}/tasks?limit=20&offset=${offset}`, {token,signal:signal || AbortSignal.timeout(15000)}),
  assign: (token,id,taskId,remove=false) => apiFetch(`/project-sprints/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`, {token,method:remove?'DELETE':'PUT',signal:AbortSignal.timeout(15000)}),
}

export const sprintsApi = {
  list: (token) => apiFetch('/sprints?limit=100', { token }),
  create: (token, payload) => apiFetch('/sprints', { method: 'POST', body: payload, token }),
  update: (token, id, payload) =>
    apiFetch(`/sprints/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, token }),
  activate: (token, id) => apiFetch(`/sprints/${encodeURIComponent(id)}/activate`, { method: 'POST', token }),
  complete: (token, id) => apiFetch(`/sprints/${encodeURIComponent(id)}/complete`, { method: 'POST', token }),
}

export const reviewsApi = {
  analyze: (token, payload) => apiFetch('/reviews/analyze', { method: 'POST', body: payload, token, signal: AbortSignal.timeout(65000) }),
  list: (token) => apiFetch('/reviews?limit=50', { token }),
  create: (token, payload) => apiFetch('/reviews', { method: 'POST', body: payload, token }),
  updateStatus: (token, id, status) =>
    apiFetch(`/reviews/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status }, token }),
}

export const documentsApi = {
  list: (token) => apiFetch('/documents?limit=100', { token }),
  generate: (token, payload) => apiFetch('/documents/generate', { method: 'POST', body: payload, token }),
  update: (token, id, payload) =>
    apiFetch(`/documents/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, token }),
  remove: (token, id) => apiFetch(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
}

export const DOCUMENT_GENERATION_TIMEOUT_MS = 150000
export const projectDocumentsApi = {
  list: (token, projectId, offset = 0, signal) => apiFetch(`/project-documents?projectId=${encodeURIComponent(projectId)}&limit=20&offset=${offset}`, { token, signal: signal || AbortSignal.timeout(15000) }),
  get: (token, id, signal) => apiFetch(`/project-documents/${encodeURIComponent(id)}`, { token, signal: signal || AbortSignal.timeout(15000) }),
  // Explicit identical-key retries only; never replay POST automatically for refresh.
  generate: (token, operation) => apiFetch('/project-documents/generate', { method: 'POST', token, body: generationPayload(operation), _retried: true, signal: AbortSignal.timeout(DOCUMENT_GENERATION_TIMEOUT_MS) }),
  async markdown(token, id, signal, retried = false) {
    const res = await fetch(`${baseUrl}/project-documents/${encodeURIComponent(id)}/markdown`, { headers: { Authorization: `Bearer ${token}` }, signal: signal || AbortSignal.timeout(15000) })
    if (res.status === 401 && refreshHandler && !retried) {
      const fresh = await refreshHandler().catch(() => null)
      if (fresh) return projectDocumentsApi.markdown(fresh, id, signal, true)
    }
    if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.message || `Markdown download failed (${res.status})`) }
    if (!res.headers.get('content-type')?.toLowerCase().startsWith('text/markdown')) throw new Error('Invalid Markdown download response.')
    return res.blob()
  },
}

export const aiApi = {
  conversations: (token, projectId) =>
    apiFetch(projectId ? `/ai/conversations?projectId=${encodeURIComponent(projectId)}` : '/ai/conversations', { token }),
  createConversation: (token, payload) => apiFetch('/ai/conversations', { method: 'POST', body: payload, token }),
  removeConversation: (token, id) => apiFetch(`/ai/conversations/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
  sendMessage: (token, id, message) =>
    apiFetch(`/ai/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { message }, token }),
  ask: (token, payload) => apiFetch('/ai/ask', { method: 'POST', body: payload, token }),
}

export const insightsApi = {
  activity: (token, limit = 20) => apiFetch(`/activity?limit=${limit}`, { token }),
  reportsSummary: (token) => apiFetch('/reports/summary', { token }),
  dashboard: (token) => apiFetch('/dashboard', { token }),
}

export const reportsApi = {
  projects:(token,signal)=>apiFetch('/reports/projects',{token,signal:signal||AbortSignal.timeout(15000)}),
  project:(token,projectId,signal)=>apiFetch(`/reports/project?projectId=${encodeURIComponent(projectId)}`,{token,signal:signal||AbortSignal.timeout(15000)}),
}

export const securityApi = {
  findings: (token) => apiFetch('/security/findings', { token }),
  audit: (token) => apiFetch('/security/audit', { token }),
  analyze: (token, payload) => apiFetch('/security/analyze', { method: 'POST', body: payload, token }),
  updateFinding: (token, id, payload) =>
    apiFetch(`/security/findings/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, token }),
}

export const teamApi = {
  list: (token) => apiFetch('/team', { token }),
  invite: (token, payload) => apiFetch('/team/invite', { method: 'POST', body: payload, token }),
  update: (token, id, payload) =>
    apiFetch(`/team/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload, token }),
  remove: (token, id) => apiFetch(`/team/${encodeURIComponent(id)}`, { method: 'DELETE', token }),
}

export const usersApi = {
  list: (token) => apiFetch('/auth/users', { token }),
  updateRole: (token, id, role) =>
    apiFetch(`/auth/users/${encodeURIComponent(id)}/role`, { method: 'PATCH', body: { role }, token }),
}

export function isBackendUnreachable(err) {
  if (!err) return false
  if (err instanceof TypeError) return true
  if (err.name === 'AbortError') return true
  if (err instanceof DOMException) return true
  const msg = String(err.message || '').toLowerCase()
  return msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch') || msg.includes('load failed')
}

export function isMockToken(token) {
  return !token || String(token).startsWith('mock.')
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KiB', 'MiB', 'GiB']
  let u = -1
  let val = bytes
  do {
    val /= 1024
    u++
  } while (val >= 1024 && u < units.length - 1)
  return `${val.toFixed(val < 10 ? 1 : 0)} ${units[u]}`
}

export function validateZipFile(file) {
  if (!file) return { valid: false, error: 'Please choose a ZIP archive to upload.' }
  const isZip = /\.zip$/i.test(file.name || '') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed'
  if (!isZip) return { valid: false, error: 'Only .zip archives are supported.' }
  if (file.size <= 0) return { valid: false, error: 'The selected ZIP archive is empty (0 bytes).' }
  const maxBytes = 50 * 1024 * 1024
  if (file.size > maxBytes) {
    return { valid: false, error: `The selected archive (${formatBytes(file.size)}) exceeds the maximum allowed limit of 50 MiB.` }
  }
  return { valid: true }
}

export const workspaceApi = {
  projects: (token, signal) => apiFetch('/workspace/projects', { token, signal }),
  files: (token, projectId, signal) => apiFetch(`/workspace/projects/${encodeURIComponent(projectId)}/files`, { token, signal }),
  read: (token, projectId, fileId, signal) => apiFetch(`/workspace/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`, { token, signal }),
  upload: (token, projectId, zip, { syncMode = 'merge', confirmed = false, async = true, signal } = {}) => {
    const params = new URLSearchParams()
    if (syncMode) params.set('syncMode', syncMode)
    if (confirmed) params.set('confirmed', 'true')
    if (async) params.set('async', 'true')
    const qs = params.toString() ? `?${params.toString()}` : ''
    return apiFetch(`/workspace/projects/${encodeURIComponent(projectId)}/upload${qs}`, {
      method: 'POST',
      token,
      rawBody: zip,
      signal: signal || AbortSignal.timeout(60000),
    })
  },
  uploadWithProgress: ({ token, projectId, file, syncMode = 'merge', confirmed = false, onProgress, signal }) => {
    return new Promise((resolve, reject) => {
      if (typeof XMLHttpRequest === 'undefined') {
        workspaceApi.upload(token, projectId, file, { syncMode, confirmed, async: true, signal })
          .then((res) => {
            if (onProgress) onProgress({ loaded: file.size || 0, total: file.size || 0, percentage: 100 })
            resolve(res)
          })
          .catch(reject)
        return
      }
      const xhr = new XMLHttpRequest()
      const params = new URLSearchParams({
        syncMode,
        ...(confirmed ? { confirmed: 'true' } : {}),
        async: 'true',
      })
      const url = `${baseUrl}/workspace/projects/${encodeURIComponent(projectId)}/upload?${params.toString()}`
      xhr.open('POST', url)
      xhr.setRequestHeader('Content-Type', 'application/zip')
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress({
              loaded: event.loaded,
              total: event.total,
              percentage: Math.round((event.loaded / event.total) * 100),
            })
          }
        }
      }

      if (signal) {
        if (signal.aborted) {
          xhr.abort()
          return reject(new DOMException('Upload aborted by user', 'AbortError'))
        }
        signal.addEventListener('abort', () => {
          xhr.abort()
          reject(new DOMException('Upload aborted by user', 'AbortError'))
        }, { once: true })
      }

      xhr.onload = () => {
        let data = {}
        try { data = JSON.parse(xhr.responseText) } catch {}
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data)
        } else {
          const err = new Error(data.message || `Upload failed with status ${xhr.status}`)
          err.status = xhr.status
          err.code = data.code
          err.data = data
          reject(err)
        }
      }

      xhr.onerror = () => {
        reject(new Error('Network error during file upload. Please check your connection.'))
      }

      xhr.ontimeout = () => {
        reject(new Error('Upload request timed out.'))
      }

      xhr.send(file)
    })
  },
  previewSync: (token, projectId, file, syncMode = 'merge', signal) => {
    const params = new URLSearchParams({ syncMode })
    return apiFetch(`/workspace/projects/${encodeURIComponent(projectId)}/sync/preview?${params.toString()}`, {
      method: 'POST',
      token,
      rawBody: file,
      signal: signal || AbortSignal.timeout(60000),
    })
  },
  indexingStatus: (token, projectId, signal) =>
    apiFetch(`/workspace/projects/${encodeURIComponent(projectId)}/indexing/status`, { token, signal }),
  indexStats: (token, projectId, signal) =>
    apiFetch(`/workspace/projects/${encodeURIComponent(projectId)}/index`, { token, signal }),
  triggerIndex: (token, projectId, signal) =>
    apiFetch(`/workspace/projects/${encodeURIComponent(projectId)}/index`, { method: 'POST', token, signal }),
}

export const repositoryReviewsApi = {
  list: (token) => apiFetch('/repository-reviews', { token }),
  stats: (token, signal) => apiFetch('/repository-reviews/stats', { token, signal: signal || AbortSignal.timeout(15000) }),
  get: (token, id, signal) => apiFetch(`/repository-reviews/${encodeURIComponent(id)}`, { token, signal }),
  create: (token, payload) => apiFetch('/repository-reviews', { method: 'POST', token, body: payload, signal: AbortSignal.timeout(110000) }),
  triage: (token, id, findingId, status, signal) => apiFetch(`/repository-reviews/${encodeURIComponent(id)}/findings/${encodeURIComponent(findingId)}`, { method: 'PATCH', token, body: { status }, signal }),
}

export const repositoryReviewBatchesApi = {
  list: (token) => apiFetch('/repository-review-batches', { token, signal: AbortSignal.timeout(15000) }),
  preview: (token, projectId, signal) => apiFetch(`/repository-review-batches/preview?projectId=${encodeURIComponent(projectId)}`, { token, signal: signal || AbortSignal.timeout(15000) }),
  get: (token, id, findingOffset = 0) => apiFetch(`/repository-review-batches/${encodeURIComponent(id)}${findingOffset ? `?findingOffset=${findingOffset}` : ''}`, { token, signal: AbortSignal.timeout(15000) }),
  create: (token, payload) => apiFetch('/repository-review-batches', { method: 'POST', token, body: payload, signal: AbortSignal.timeout(15000) }),
}
