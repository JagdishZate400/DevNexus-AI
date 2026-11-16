const crypto = require('crypto')
const { Router } = require('express')
const { body, param } = require('express-validator')
const { conversations } = require('../db/memory')
const { createMemoryConversationRepository } = require('../db/aiConversationRepository')
const { authRequired } = require('../middleware/auth')
const { validate, asyncHandler } = require('../middleware/http')
const { generateReply } = require('../services/ai')
const { logActivity } = require('../services/activity')
const config = require('../config')
const { authorizeProject, generateRepositoryReply } = require('../services/repositoryChat')

function getConversationRepo(req) {
  return (
    req.app?.locals?.conversationRepository ||
    createMemoryConversationRepository(conversations)
  )
}

async function replyFor(req, conversation, message) {
  if (config.aiProvider === 'gemini' && conversation.projectId) {
    return generateRepositoryReply(req, { message, projectId: conversation.projectId, history: conversation.messages })
  }
  const result = await generateReply({ message, projectId: conversation.projectId, history: conversation.messages })
  return { ...result, mode: 'general', grounded: false }
}

const router = Router()
router.use(authRequired)

router.get('/conversations', asyncHandler(async (req, res) => {
  const repo = getConversationRepo(req)
  let list = await repo.listConversations(req.user.email, { projectId: req.query.projectId })
  if (config.aiProvider === 'gemini') {
    const accessible = []
    for (const conv of list) {
      try {
        if (conv.projectId) await authorizeProject(req, conv.projectId)
        accessible.push(conv)
      } catch (err) {
        if (err.status !== 404) throw err
      }
    }
    list = accessible
  }
  return res.json({ conversations: list })
}))

router.post(
  '/conversations',
  [
    body('projectId').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('title').optional().isString().isLength({ max: 200 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (config.aiProvider === 'gemini' && req.body.projectId) await authorizeProject(req, req.body.projectId)
    const repo = getConversationRepo(req)
    const conv = await repo.createConversation({
      projectId: req.body.projectId || null,
      title: req.body.title || 'New Chat',
      createdBy: req.user.email,
    })
    return res.status(201).json({ conversation: conv })
  })
)

router.get('/conversations/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, asyncHandler(async (req, res) => {
  const repo = getConversationRepo(req)
  const conv = await repo.findConversation(req.params.id, req.user.email)
  if (!conv) return res.status(404).json({ message: 'Conversation not found', code: 'not_found' })
  if (config.aiProvider === 'gemini' && conv.projectId) await authorizeProject(req, conv.projectId)
  return res.json({ conversation: conv })
}))

router.delete('/conversations/:id', [param('id').trim().isLength({ min: 1, max: 80 })], validate, asyncHandler(async (req, res) => {
  const repo = getConversationRepo(req)
  const deleted = await repo.deleteConversation(req.params.id, req.user.email)
  if (!deleted) return res.status(404).json({ message: 'Conversation not found', code: 'not_found' })
  return res.status(204).end()
}))

router.post(
  '/conversations/:id/messages',
  [
    param('id').trim().isLength({ min: 1, max: 80 }),
    body('message').isString().bail().trim().isLength({ min: 1, max: 4000 }).withMessage('Message is required.'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const repo = getConversationRepo(req)
    const conv = await repo.findConversation(req.params.id, req.user.email)
    if (!conv) return res.status(404).json({ message: 'Conversation not found', code: 'not_found' })
    if (config.aiProvider === 'gemini' && conv.projectId) await authorizeProject(req, conv.projectId)

    const userMsg = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      role: 'user',
      content: req.body.message,
      createdAt: new Date().toISOString(),
    }

    const { reply, sources, provider, notice, mode, grounded } = await replyFor(req, conv, req.body.message)
    const assistantMsg = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      role: 'assistant',
      content: reply,
      sources: sources || [],
      provider,
      notice, mode, grounded,
      createdAt: new Date().toISOString(),
    }

    const newTitle = conv.title === 'New Chat' ? String(req.body.message).slice(0, 60) : undefined
    const updatedConv = await repo.appendMessages(conv.id, req.user.email, [userMsg, assistantMsg], { newTitle })

    logActivity({
      type: 'ai',
      message: `AI chat in ${conv.projectId || 'workspace'}`,
      actorEmail: req.user.email,
      projectId: conv.projectId,
    })
    return res.status(201).json({ userMessage: userMsg, assistantMessage: assistantMsg, conversation: updatedConv })
  })
)

// Stateless ask: creates a conversation on the fly when none is supplied.
router.post(
  '/ask',
  [
    body('message').isString().bail().trim().isLength({ min: 1, max: 4000 }).withMessage('Message is required.'),
    body('projectId').optional({ nullable: true }).isString().isLength({ max: 120 }),
    body('conversationId').optional().isString().isLength({ max: 80 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const repo = getConversationRepo(req)
    let conv = req.body.conversationId ? await repo.findConversation(req.body.conversationId, req.user.email) : null
    if (req.body.conversationId && !conv) {
      return res.status(404).json({ message: 'Conversation not found', code: 'not_found' })
    }
    if (conv && req.body.projectId !== undefined && (req.body.projectId || null) !== conv.projectId) {
      return res.status(400).json({ code: 'project_mismatch', message: 'Conversation project cannot be changed.' })
    }
    const isNew = !conv
    if (!conv) {
      conv = {
        id: `conv-${crypto.randomUUID().slice(0, 8)}`,
        title: String(req.body.message).slice(0, 60) || 'New Chat',
        projectId: req.body.projectId || null,
        createdBy: req.user.email,
        messages: [],
      }
    }

    const userMsg = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      role: 'user',
      content: req.body.message,
      createdAt: new Date().toISOString(),
    }
    const { reply, sources, provider, notice, mode, grounded } = await replyFor(req, conv, req.body.message)
    const assistantMsg = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      role: 'assistant',
      content: reply,
      sources: sources || [],
      provider,
      notice, mode, grounded,
      createdAt: new Date().toISOString(),
    }

    if (isNew) {
      await repo.createConversation({
        id: conv.id,
        title: conv.title,
        projectId: conv.projectId,
        createdBy: conv.createdBy,
      })
    }

    const updatedConv = await repo.appendMessages(conv.id, req.user.email, [userMsg, assistantMsg], { newTitle: conv.title })
    return res.status(201).json({ userMessage: userMsg, assistantMessage: assistantMsg, conversation: updatedConv })
  })
)

module.exports = router
