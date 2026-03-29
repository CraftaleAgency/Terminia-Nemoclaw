import type { Request, Response, NextFunction } from 'express'
import express from 'express'
import cors from 'cors'

import authMiddleware, { requireCompanyMatch } from './middleware/auth.ts'
import analyzeRouter from './routes/analyze.ts'
import osintRouter from './routes/osint.ts'
import chatRouter from './routes/chat.ts'
import ocrRouter from './routes/ocr.ts'
import documentsRouter from './routes/documents.ts'
import conversationsRouter from './routes/conversations.ts'
import { chatCompletion } from './lib/inference.ts'
import { startNotifierSchedule, runNotifierJob } from './lib/notifier.ts'

const app = express()
const PORT = process.env.PORT || 3100
const VERSION = '1.0.0'

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,https://terminia.pezserv.org')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error('CORS non consentito'))
  },
  credentials: true,
}))

// ── Body parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }))

// ── Health endpoint (no auth) ───────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() })
})

// ── Manual notifier trigger (protected by shared secret) ────────────────────
app.post('/api/notifier/run', (req: Request, res: Response) => {
  const secret = req.headers['x-cron-secret'] || req.query.secret
  if (secret !== (process.env.CRON_SECRET || 'terminia-cron-2024')) {
    return res.status(403).json({ error: 'Non autorizzato' })
  }
  void runNotifierJob().then(result => res.json(result))
})

// ── Rate limiting (basic in-memory) ─────────────────────────────────────────
interface RateLimitEntry {
  start: number
  count: number
}

const rateLimitMap = new Map<string, RateLimitEntry>()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const key = req.user?.id || req.ip || 'unknown'
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { start: now, count: 1 })
    next()
    return
  }

  entry.count++
  if (entry.count > RATE_LIMIT_MAX) {
    res.status(429).json({ error: 'Troppe richieste. Riprova tra poco.' })
    return
  }
  next()
}

// Periodically clean rate limit map
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.start > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(key)
  }
}, RATE_LIMIT_WINDOW_MS)

// ── Authenticated routes ────────────────────────────────────────────────────
app.use('/api/analyze', authMiddleware, rateLimit, requireCompanyMatch, analyzeRouter)
app.use('/api/osint', authMiddleware, rateLimit, requireCompanyMatch, osintRouter)
app.use('/api/chat', authMiddleware, rateLimit, requireCompanyMatch, chatRouter)
app.use('/api/ocr', authMiddleware, rateLimit, requireCompanyMatch, ocrRouter)

// ── Unauthenticated analyze for registration (rate-limited, skip_persist forced) ──
app.use('/api/analyze-public', rateLimit, (req, res, next) => {
  req.body.skip_persist = true
  req.body.company_id = req.body.company_id || null
  next()
}, analyzeRouter)

// ── Document upload (public for registration, rate-limited) ─────────────────
app.use('/api/documents', rateLimit, documentsRouter)
app.use('/api/conversations', rateLimit, conversationsRouter)

// ── Global error handler ────────────────────────────────────────────────────
app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err.message)
  const status = err.status || 500
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Errore interno del server'
      : err.message,
  })
})

// ── Start ───────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  console.log(`🐙 Terminia NemoClaw API v${VERSION}`)
  console.log(`   Port: ${PORT}`)
  console.log(`   CORS: ${allowedOrigins.join(', ')}`)
  console.log(`   LiteLLM: ${process.env.LITELLM_URL || 'http://litellm-proxy:4000'}`)
  console.log(`   Supabase: ${process.env.SUPABASE_URL ? '✓' : '✗ (missing)'}`)
  console.log(`   Resend: ${process.env.RESEND_API_KEY ? '✓' : '✗ (missing)'}`)

  // Start daily notifier cron
  startNotifierSchedule()
  void (async () => {
    const registrationModel = process.env.REGISTRATION_MODEL || 'nemotron-orchestrator'
    try {
      await chatCompletion({
        model: registrationModel,
        messages: [
          { role: 'system', content: 'Return ONLY {"ok":true}' },
          { role: 'user', content: 'warmup' },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 96,
      })
      console.log(`   Registration model warm: ${registrationModel}`)
    } catch (err) {
      console.error(`[warmup] Registration model failed: ${(err as Error).message}`)
    }
  })()
})

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down gracefully...`)
  server.close(() => {
    console.log('[shutdown] HTTP server closed')
    process.exit(0)
  })
  // Force exit after 10s if connections won't close
  setTimeout(() => {
    console.error('[shutdown] Forced exit after timeout')
    process.exit(1)
  }, 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
