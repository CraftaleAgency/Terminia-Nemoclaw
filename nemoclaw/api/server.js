import express from 'express'
import cors from 'cors'

import authMiddleware, { requireCompanyMatch } from './middleware/auth.js'
import analyzeRouter from './routes/analyze.js'
import osintRouter from './routes/osint.js'
import chatRouter from './routes/chat.js'
import ocrRouter from './routes/ocr.js'

const app = express()
const PORT = process.env.PORT || 3100
const VERSION = '1.0.0'

// ── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3000,https://terminia.pezserv.org')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

app.use(cors({
  origin(origin, cb) {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true)
    cb(new Error('CORS non consentito'))
  },
  credentials: true,
}))

// ── Body parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }))

// ── Health endpoint (no auth) ───────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: VERSION, timestamp: new Date().toISOString() })
})

// ── Rate limiting (basic in-memory) ─────────────────────────────────────────
const rateLimitMap = new Map()
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX = 60

function rateLimit(req, res, next) {
  const key = req.user?.id || req.ip
  const now = Date.now()
  const entry = rateLimitMap.get(key)

  if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(key, { start: now, count: 1 })
    return next()
  }

  entry.count++
  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Troppe richieste. Riprova tra poco.' })
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
app.use('/api/ocr', authMiddleware, rateLimit, ocrRouter)

// ── Global error handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message)
  const status = err.status || 500
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Errore interno del server'
      : err.message,
  })
})

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🐙 Terminia NemoClaw API v${VERSION}`)
  console.log(`   Port: ${PORT}`)
  console.log(`   CORS: ${allowedOrigins.join(', ')}`)
  console.log(`   LiteLLM: ${process.env.LITELLM_URL || 'http://litellm-proxy:4000'}`)
  console.log(`   Supabase: ${process.env.SUPABASE_URL ? '✓' : '✗ (missing)'}`)
})
