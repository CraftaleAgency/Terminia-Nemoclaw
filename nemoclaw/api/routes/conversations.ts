import type { Request, Response } from 'express'
import { Router } from 'express'
import supabase from '../lib/supabase.ts'

const router = Router()

// GET /api/conversations — list user's conversations
router.get('/', async (req: Request, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Non autenticato' })

  const { data, error } = await supabase
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ conversations: data })
})

// POST /api/conversations — create new conversation
router.post('/', async (req: Request, res: Response) => {
  const userId = req.user?.id
  const companyId = req.body.company_id || req.user?.company_id
  if (!userId) return res.status(401).json({ error: 'Non autenticato' })

  const { data, error } = await supabase
    .from('conversations')
    .insert({
      user_id: userId,
      company_id: companyId,
      title: req.body.title || 'Nuova conversazione',
    })
    .select('id, title, created_at, updated_at')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.json(data)
})

// GET /api/conversations/:id/messages — get messages for a conversation
router.get('/:id/messages', async (req: Request, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Non autenticato' })

  // Verify ownership
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', req.params.id)
    .eq('user_id', userId)
    .single()

  if (!conv) return res.status(404).json({ error: 'Conversazione non trovata' })

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, attachment, created_at')
    .eq('conversation_id', req.params.id)
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ messages: data })
})

// POST /api/conversations/:id/messages — add message to conversation
router.post('/:id/messages', async (req: Request, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Non autenticato' })

  const { role, content, attachment } = req.body
  if (!role || !content) {
    return res.status(400).json({ error: 'role e content sono obbligatori' })
  }

  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: req.params.id,
      role,
      content,
      attachment: attachment || null,
    })
    .select('id, role, content, attachment, created_at')
    .single()

  if (error) return res.status(500).json({ error: error.message })

  // Update conversation timestamp
  await supabase
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', req.params.id)

  return res.json(data)
})

// PATCH /api/conversations/:id — rename conversation
router.patch('/:id', async (req: Request, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Non autenticato' })

  const { title } = req.body
  if (!title) return res.status(400).json({ error: 'title obbligatorio' })

  const { error } = await supabase
    .from('conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('user_id', userId)

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ success: true })
})

// DELETE /api/conversations/:id — delete conversation and messages
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = req.user?.id
  if (!userId) return res.status(401).json({ error: 'Non autenticato' })

  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', userId)

  if (error) return res.status(500).json({ error: error.message })
  return res.json({ success: true })
})

export default router
