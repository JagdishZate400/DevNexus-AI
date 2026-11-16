import { create } from 'zustand'
import { aiApi, isBackendUnreachable, isMockToken } from '../services/api'
import { useAuthStore } from './authStore'

function normalizeSources(sources) {
  return (sources || []).map((s) => typeof s === 'string' ? s : s?.citationId ? s : s?.path).filter(Boolean)
}

function toLocalConversation(server) {
  return {
    id: server.id,
    title: server.title,
    projectId: server.projectId,
    timestamp: server.updatedAt || server.createdAt || new Date().toISOString(),
    messages: (server.messages || []).map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.createdAt || new Date().toISOString(),
      sources: normalizeSources(m.sources),
      provider: m.provider,
      notice: m.notice, mode: m.mode, grounded: m.grounded,
    })),
  }
}

function localConversation(projectId, title) {
  return {
    id: `conv-${Date.now()}`,
    title: title || 'New Chat',
    projectId,
    timestamp: new Date(),
    messages: [],
  }
}

// Keyword-aware mock responses for realistic offline demo
const keywordResponses = [
  {
    keywords: ['auth', 'login', 'jwt', 'token', 'password', 'session'],
    content: `The authentication system uses **JWT-based sessions** with bcrypt password hashing. Here is how it works:\n\n1. **Login:** Credentials are validated against PostgreSQL, passwords compared with bcrypt (cost factor 10)\n2. **Token issuance:** A signed JWT (HS256) is issued with 1-hour expiry, including user ID, email, role, and token version\n3. **Refresh:** Opaque rotating refresh tokens with reuse detection — if a rotated token is replayed, all sessions for that user are revoked\n4. **Protection:** Rate limiting (100 req/15min on auth endpoints), account lockout after 5 failed attempts (15 min), and timing-safe comparisons\n\nKey files: \`backend/middleware/auth.js\`, \`backend/routes/auth.js\`, \`backend/services/tokens.js\``,
    sources: ['backend/middleware/auth.js', 'backend/routes/auth.js', 'backend/services/tokens.js'],
  },
  {
    keywords: ['database', 'schema', 'table', 'model', 'query', 'sql', 'postgres'],
    content: `The database uses **PostgreSQL** with the following key tables:\n\n- **users** — id, email, password_hash, role, token_version, created_at\n- **projects** — id, name, description, stack, status, owner_email, progress\n- **tasks** — id, title, description, status, priority, assignee_email, project_id\n- **sprints** — id, name, goal, start_date, end_date, status, progress\n- **reviews** — id, title, project_id, status, findings_count\n- **documents** — id, title, type, project_id, status\n\nAll queries use parameterized statements to prevent SQL injection. The \`isOwnerOrManager()\` helper enforces row-level access control.`,
    sources: ['backend/src/db/memory.js', 'backend/src/routes/projects.js'],
  },
  {
    keywords: ['api', 'endpoint', 'route', 'rest', 'request', 'response'],
    content: `The API follows **REST conventions** with these main endpoints:\n\n- \`POST /api/auth/register\` — Create account (requires verified email)\n- \`POST /api/auth/login\` — Authenticate and receive JWT + refresh token\n- \`POST /api/auth/refresh\` — Rotate refresh token\n- \`GET /api/projects\` — List projects (paginated, searchable)\n- \`POST /api/projects\` — Create project\n- \`GET /api/tasks?priority=High\` — Filter tasks by priority\n- \`GET /api/security/findings\` — Security findings (manager role)\n\nAll endpoints return JSON with consistent error codes (\`unauthorized\`, \`forbidden\`, \`not_found\`, \`validation_error\`).`,
    sources: ['backend/src/routes/projects.js', 'backend/src/routes/auth.js'],
  },
  {
    keywords: ['deploy', 'docker', 'ci', 'cd', 'pipeline', 'build'],
    content: `The deployment uses **Docker Compose** with the following services:\n\n- **backend** — Node.js 20 Alpine, port 5001, with \`npm ci --omit=dev\`\n- **postgres** — PostgreSQL 16 Alpine, persistent volume \`pgdata\`\n- **redis** — Redis 7 Alpine for session caching\n\nThe CI/CD pipeline runs on GitHub Actions:\n1. Lint + type check\n2. Unit tests (46 tests)\n3. Security audit (\`npm audit\` + custom checks)\n4. Build Docker image\n5. Deploy to staging on merge to main`,
    sources: ['docker-compose.yml', 'backend/Dockerfile'],
  },
  {
    keywords: ['test', 'testing', 'spec', 'coverage'],
    content: `The project has **46 backend tests** covering:\n\n- Authentication (register, login, refresh, logout, password reset)\n- Authorization (RBAC, role changes, ownership checks)\n- CRUD operations (projects, tasks, sprints, team, reviews, documents)\n- Security (rate limiting, account lockout, token reuse detection, CORS)\n- AI service (mock fallback, OpenRouter integration, conversation management)\n\nRun tests with: \`npm test\` (uses Node.js built-in test runner)`,
    sources: ['backend/tests/auth.test.js', 'backend/tests/projects.test.js'],
  },
  {
    keywords: ['security', 'vulnerability', 'xss', 'injection', 'cors'],
    content: `Security measures in place:\n\n- **Helmet.js** — Security headers (CSP, HSTS, X-Frame-Options)\n- **CORS** — Allowlist-based, credentials disabled\n- **Rate limiting** — General (200/15min), auth (100/15min), AI (60/min)\n- **Input validation** — express-validator on all endpoints\n- **Password policy** — Min 8 chars, uppercase, lowercase, number, symbol\n- **Account lockout** — 5 failed attempts → 15 min lock\n- **Token security** — HS256 pinned, issuer/audience validation, rotation\n\nCurrent findings: 11 total (2 Critical, 3 High, 4 Medium, 2 Low)`,
    sources: ['backend/src/db/securityFindings.js', 'backend/src/middleware/auth.js'],
  },
  {
    keywords: ['architecture', 'structure', 'folder', 'file', 'organize'],
    content: `The project follows a **layered architecture**:\n\n\`\`\`\nbackend/src/\n├── middleware/     # auth, rbac, http (error handling, validation)\n├── routes/         # Express routers (auth, projects, tasks, ai, etc.)\n├── services/       # Business logic (tokens, mailer, ai, securityLog)\n├── db/             # In-memory stores (swap for PostgreSQL)\n└── config.js       # Environment configuration\n\nfrontend/src/\n├── components/     # Reusable UI (auth, dashboard, aiChat, etc.)\n├── pages/          # Route-level components\n├── store/          # Zustand state management\n├── services/       # API client layer\n└── data/           # Mock data for offline demo\n\`\`\``,
    sources: ['backend/src/app.js', 'frontend/src/main.jsx'],
  },
  {
    keywords: ['performance', 'optimize', 'speed', 'slow', 'cache'],
    content: `Performance optimizations:\n\n- **Frontend:** Code splitting via React.lazy, Zustand selective subscriptions, useMemo for expensive computations\n- **Backend:** In-memory data stores (O(1) lookups), rate limiting to prevent abuse, 100kb body size cap\n- **Database:** Indexed queries, parameterized statements, connection pooling (when PostgreSQL is configured)\n- **AI:** AbortController timeouts (15s for AI service, 30s for OpenRouter), message truncation (4000 chars)\n\nCurrent metrics: API response times avg 5-15ms, frontend bundle 620kb (167kb gzipped).`,
    sources: ['backend/src/app.js', 'frontend/vite.config.js'],
  },
]

const defaultResponses = {
  'e-commerce-platform': [
    {
      content: `The **E-Commerce Platform** is a full-stack commerce application built with React, Node.js, and PostgreSQL. It features product catalog management, shopping cart, order processing, and payment integration.\n\n**Key metrics:**\n- 72% complete\n- 4 team members\n- 3 active tasks\n- Last updated 30 minutes ago\n\nAsk me about authentication, database schema, API endpoints, or deployment.`,
      sources: ['backend/src/routes/projects.js', 'frontend/src/pages/ProjectsPage.jsx'],
    },
    {
      content: `The E-Commerce Platform uses a **React frontend** with Tailwind CSS and React Router, and a **Node.js/Express backend** with JWT authentication.\n\n**Tech stack:**\n- **Frontend:** React 18, Tailwind CSS, Zustand, React Router\n- **Backend:** Node.js 20, Express 4, PostgreSQL 16\n- **Auth:** JWT (HS256), bcrypt, refresh token rotation\n- **Testing:** Node.js test runner (46 tests)`,
      sources: ['package.json', 'backend/package.json'],
    },
  ],
  'task-management-system': [
    {
      content: `The **Task Management System** is a collaborative planning workspace with Kanban boards, sprint planning, and team collaboration features.\n\n**Key metrics:**\n- 58% complete\n- 5 team members\n- 2 active tasks\n- Last updated 2 hours ago\n\nAsk me about task workflows, sprint planning, or team management.`,
      sources: ['backend/src/routes/tasks.js', 'frontend/src/pages/TasksPage.jsx'],
    },
  ],
  'portfolio-analyzer': [
    {
      content: `The **Portfolio Analyzer** is a Python-based tool with FastAPI backend and AI-powered insights for investment portfolio analysis.\n\n**Key metrics:**\n- 100% complete\n- 3 team members\n- Analysis complete\n- Last updated 1 day ago\n\nAsk me about the analysis methodology, data sources, or API endpoints.`,
      sources: ['backend/main.py', 'frontend/src/pages/DashboardPage.jsx'],
    },
  ],
}

function mockAssistantMessage(projectId, userMessage) {
  const text = String(userMessage || '').toLowerCase()

  for (const response of keywordResponses) {
    if (response.keywords.some((kw) => text.includes(kw))) {
      return {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: response.content,
        timestamp: new Date(),
        sources: response.sources,
      }
    }
  }

  const projectResponses = defaultResponses[projectId] || [
    {
      content: `I can help you with questions about the **${projectId}** project. Try asking about:\n\n- Authentication and security\n- Database schema and models\n- API endpoints and routes\n- Deployment and CI/CD\n- Testing and code quality\n- Project architecture`,
      sources: ['README.md'],
    },
  ]
  const pick = projectResponses[Math.floor(Math.random() * projectResponses.length)]
  return {
    id: `msg-${Date.now()}`,
    role: 'assistant',
    content: pick.content,
    timestamp: new Date(),
    sources: pick.sources,
  }
}

export const useAIChatStore = create((set, get) => ({
  // Project selection
  selectedProjectId: null,
  setSelectedProjectId: (projectId) => set((state) => ({ selectedProjectId: projectId, selectedConversationId: state.conversations.find((c) => c.projectId === projectId)?.id || null, selectedSourcePath: null })),

  // Conversations
  conversations: [],
  selectedConversationId: null,
  setSelectedConversationId: (id) => set((state) => ({ selectedConversationId: id, selectedProjectId: state.conversations.find((c) => c.id === id)?.projectId || null, selectedSourcePath: null })),
  source: 'local',
  loadError: '',
  // Tracks which conversations live on the server (vs local-only).
  serverIds: [],

  loadConversations: async () => {
    const sessionEmail = useAuthStore.getState().user?.email
    const token = useAuthStore.getState().token
    if (isMockToken(token)) {
      set({ source: 'local', loadError: '' })
      return get().conversations
    }
    try {
      const data = await aiApi.conversations(token)
      if (useAuthStore.getState().user?.email !== sessionEmail) return []
      const conversations = (data.conversations || []).map(toLocalConversation)
      const { selectedProjectId, selectedConversationId } = get()
      let selected = conversations.find((c) => c.id === selectedConversationId)?.id || null
      if (conversations.length === 0) {
        const created = await aiApi.createConversation(token, { projectId: selectedProjectId })
        if (useAuthStore.getState().user?.email !== sessionEmail) return []
        const conv = toLocalConversation(created.conversation)
        conversations.unshift(conv)
        selected = conv.id
      } else if (!selected) {
        const forProject =
          conversations.find((c) => c.projectId === selectedProjectId)
        selected = forProject?.id || null
      }
      set({
        conversations,
        selectedConversationId: selected,
        serverIds: conversations.map((c) => c.id),
        source: 'api',
        loadError: '',
      })
      return conversations
    } catch (err) {
      set({ loadError: err.message || 'Could not load conversations.' })
      return get().conversations
    }
  },

  // New conversation creation
  createNewConversation: async (projectId) => {
    const token = useAuthStore.getState().token
    if (isMockToken(token)) {
      const newConversation = localConversation(projectId)
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
        selectedConversationId: newConversation.id,
      }))
      return newConversation
    }
    try {
      const data = await aiApi.createConversation(token, { projectId })
      const newConversation = toLocalConversation(data.conversation)
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
        selectedConversationId: newConversation.id,
        serverIds: [...state.serverIds, newConversation.id],
        source: 'api',
        loadError: '',
      }))
      return newConversation
    } catch (err) {
      set({ loadError: err.message || 'Could not create the conversation.' })
      throw err
    }
  },

  // Message management (local append; used by the offline path).
  addMessage: (conversationId, message) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === conversationId
          ? { ...conv, messages: [...conv.messages, message], timestamp: message.timestamp || new Date() }
          : conv
      ),
    })),

  // Full send pipeline: server when signed in, mock responder offline.
  sendMessage: async (conversationId, content) => {
    const text = String(content || '').trim()
    if (!text) return null
    const token = useAuthStore.getState().token
    const onServer = get().serverIds.includes(conversationId) && !isMockToken(token)
    const userMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    }
    if (!onServer && !isMockToken(token)) {
      throw new Error('This conversation is local. Create a backend conversation to use live AI.')
    }
    if (!onServer) {
      get().addMessage(conversationId, userMessage)
      await new Promise((resolve) => setTimeout(resolve, 600))
      const reply = mockAssistantMessage(get().conversations.find((c) => c.id === conversationId)?.projectId, text)
      const state = get()
      if (!state.conversations.some((c) => c.id === conversationId)) return null
      state.addMessage(conversationId, reply)
      return { userMessage, assistantMessage: reply, source: 'local' }
    }
    // Optimistic user message; replaced by server echo on success.
    get().addMessage(conversationId, userMessage)
    try {
      const data = await aiApi.sendMessage(token, conversationId, text)
      const serverUser = {
        id: data.userMessage.id,
        role: 'user',
        content: data.userMessage.content,
        timestamp: data.userMessage.createdAt,
      }
      const assistant = {
        id: data.assistantMessage.id,
        role: 'assistant',
        content: data.assistantMessage.content,
        timestamp: data.assistantMessage.createdAt,
        sources: normalizeSources(data.assistantMessage.sources),
        provider: data.assistantMessage.provider,
        notice: data.assistantMessage.notice, mode: data.assistantMessage.mode, grounded: data.assistantMessage.grounded,
      }
      set((state) => ({
        conversations: state.conversations.map((conv) => {
          if (conv.id !== conversationId) return conv
          const messages = [...conv.messages]
          const optimistic = messages.findIndex((m) => m.id === userMessage.id)
          if (optimistic >= 0) messages[optimistic] = serverUser
          else messages.push(serverUser)
          messages.push(assistant)
          if (data.conversation?.title) conv = { ...conv, title: data.conversation.title }
          return { ...conv, messages, timestamp: assistant.timestamp };
        }),
        loadError: '',
      }))
      return { userMessage: serverUser, assistantMessage: assistant, source: 'api' }
    } catch (err) {
      // Roll back the optimistic message on real failures.
      set((state) => ({
        conversations: state.conversations.map((conv) =>
          conv.id === conversationId
            ? { ...conv, messages: conv.messages.filter((m) => m.id !== userMessage.id) }
            : conv
        ),
      }))
      set({ loadError: err.message || 'Could not send the message.' })
      throw err
    }
  },

  // Delete conversation
  deleteConversation: async (conversationId) => {
    const token = useAuthStore.getState().token
    const onServer = get().serverIds.includes(conversationId) && !isMockToken(token)
    if (onServer) {
      try {
        await aiApi.removeConversation(token, conversationId)
      } catch (err) {
        if (!isBackendUnreachable(err)) {
          set({ loadError: err.message || 'Could not delete the conversation.' })
          throw err
        }
      }
    }
    set((state) => {
      const filtered = state.conversations.filter((c) => c.id !== conversationId)
      return {
        conversations: filtered,
        serverIds: state.serverIds.filter((id) => id !== conversationId),
        selectedConversationId:
          state.selectedConversationId === conversationId
            ? filtered[0]?.id || null
            : state.selectedConversationId,
      }
    })
  },

  // Source preview state
  selectedSourcePath: null,
  setSelectedSourcePath: (path) => set({ selectedSourcePath: path }),
}))

// Prevent cached source/citations surviving a switch to a different signed-in user.
useAuthStore.subscribe((state, previous) => {
  if (state.user?.email !== previous.user?.email) useAIChatStore.setState({ conversations: [], serverIds: [], selectedConversationId: null, selectedProjectId: null, selectedSourcePath: null, loadError: '', source: 'local' })
})
