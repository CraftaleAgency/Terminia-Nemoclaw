import type { Request, Response, NextFunction } from 'express'
import { createClient } from '@supabase/supabase-js'

// Lightweight client for JWT verification only
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

/**
 * Express middleware: verify Supabase JWT and attach user info to req.user.
 */
export default async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Token mancante o formato non valido' })
    return
  }

  const token = header.slice(7)

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      res.status(401).json({ error: 'Token non valido o scaduto' })
      return
    }

    const metadata = user.user_metadata || {}

    req.user = {
      id: user.id,
      email: user.email!,
      company_id: metadata.company_id || null,
      role: metadata.role || 'user',
    }

    next()
  } catch (err) {
    console.error('[auth] Unexpected error:', (err as Error).message)
    res.status(401).json({ error: 'Errore di autenticazione' })
  }
}

/**
 * Validate that the request's company_id matches the authenticated user's company.
 * Use after authMiddleware.
 */
export function requireCompanyMatch(req: Request, res: Response, next: NextFunction): void {
  const bodyCompanyId = req.body?.company_id as string | undefined
  if (bodyCompanyId && req.user!.company_id && bodyCompanyId !== req.user!.company_id) {
    res.status(403).json({ error: 'company_id non corrisponde all\'utente autenticato' })
    return
  }
  // If body doesn't specify company_id, inject the user's company
  if (!bodyCompanyId && req.user!.company_id) {
    req.body = req.body || {}
    req.body.company_id = req.user!.company_id
  }
  next()
}
