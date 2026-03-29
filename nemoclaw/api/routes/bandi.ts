import type { Request, Response } from 'express'
import { Router } from 'express'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import supabase from '../lib/supabase.ts'

const execFileAsync = promisify(execFile)
const router = Router()

const SKILLS_DIR = process.env.SKILLS_DIR || '/sandbox/.openclaw/skills'
const SKILL_TIMEOUT_MS = 120_000 // 2 minutes per skill

interface SkillResult {
  synced?: number
  skipped_duplicates?: number
  errors?: number
  matched?: number
  alerts_created?: number
  source?: string
  error?: string
  [key: string]: unknown
}

async function runSkill(skillName: string, input: Record<string, unknown> = {}): Promise<SkillResult> {
  const handlerPath = path.join(SKILLS_DIR, skillName, 'scripts', 'handler.ts')

  const { stdout, stderr } = await execFileAsync(
    'node',
    ['--experimental-strip-types', handlerPath],
    {
      timeout: SKILL_TIMEOUT_MS,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
      },
      encoding: 'utf8',
      // Pipe input JSON via stdin
      ...(Object.keys(input).length > 0 ? {} : {}),
    },
  )

  if (stderr) {
    console.warn(`[bandi] ${skillName} stderr:`, stderr.slice(0, 500))
  }

  try {
    return JSON.parse(stdout.trim()) as SkillResult
  } catch {
    return { error: `Invalid JSON output from ${skillName}: ${stdout.slice(0, 200)}` }
  }
}

async function runSkillWithStdin(skillName: string, input: Record<string, unknown> = {}): Promise<SkillResult> {
  const handlerPath = path.join(SKILLS_DIR, skillName, 'scripts', 'handler.ts')
  const inputJson = JSON.stringify(input)

  return new Promise((resolve) => {
    const child = execFile(
      'node',
      ['--experimental-strip-types', handlerPath],
      {
        timeout: SKILL_TIMEOUT_MS,
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (stderr) console.warn(`[bandi] ${skillName} stderr:`, stderr.slice(0, 500))
        if (error) {
          resolve({ error: `${skillName} failed: ${error.message}` })
          return
        }
        try {
          resolve(JSON.parse(stdout.trim()) as SkillResult)
        } catch {
          resolve({ error: `Invalid JSON from ${skillName}: ${stdout.slice(0, 200)}` })
        }
      },
    )
    if (child.stdin) {
      child.stdin.write(inputJson)
      child.stdin.end()
    }
  })
}

/**
 * POST /api/bandi/sync
 * Triggers the full BandoRadar pipeline: sync-anac → sync-ted → match → email
 * Body: { company_id? } (optional, defaults to user's company)
 */
router.post('/sync', async (req: Request, res: Response) => {
  const companyId = req.body.company_id || req.user?.company_id
  if (!companyId) {
    return res.status(400).json({ error: 'company_id richiesto' })
  }

  const userId = req.user?.id
  const results: Record<string, SkillResult> = {}
  const steps = ['bandi-sync-anac', 'bandi-sync-ted', 'bandi-match']
  let currentStep = 0

  // SSE for progress
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders()

  const sendEvent = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // Step 1: Sync ANAC
    sendEvent({ step: 'bandi-sync-anac', status: 'running', progress: 0, message: 'Sincronizzazione bandi ANAC...' })
    results['bandi-sync-anac'] = await runSkillWithStdin('bandi-sync-anac', { company_id: companyId })
    currentStep++
    sendEvent({ step: 'bandi-sync-anac', status: 'done', progress: 33, result: results['bandi-sync-anac'] })

    // Step 2: Sync TED
    sendEvent({ step: 'bandi-sync-ted', status: 'running', progress: 33, message: 'Sincronizzazione bandi TED Europa...' })
    results['bandi-sync-ted'] = await runSkillWithStdin('bandi-sync-ted', { days_back: 7 })
    currentStep++
    sendEvent({ step: 'bandi-sync-ted', status: 'done', progress: 66, result: results['bandi-sync-ted'] })

    // Step 3: Match scoring
    sendEvent({ step: 'bandi-match', status: 'running', progress: 66, message: 'Analisi compatibilita in corso...' })
    results['bandi-match'] = await runSkillWithStdin('bandi-match', { company_id: companyId })
    currentStep++
    sendEvent({ step: 'bandi-match', status: 'done', progress: 100, result: results['bandi-match'] })

    // Step 4: Send email notification if there are high-match alerts
    const matchResult = results['bandi-match']
    if (matchResult.alerts_created && matchResult.alerts_created > 0) {
      try {
        const { runNotifierJob } = await import('../lib/notifier.ts')
        await runNotifierJob()
        sendEvent({ step: 'email', status: 'done', message: 'Notifiche inviate' })
      } catch (emailErr) {
        sendEvent({ step: 'email', status: 'error', message: (emailErr as Error).message })
      }
    }

    // Final summary
    const totalSynced = (results['bandi-sync-anac']?.synced || 0) + (results['bandi-sync-ted']?.synced || 0)
    const totalMatched = results['bandi-match']?.matched || 0
    const alertsCreated = results['bandi-match']?.alerts_created || 0

    sendEvent({
      step: 'complete',
      status: 'done',
      progress: 100,
      summary: {
        total_synced: totalSynced,
        total_matched: totalMatched,
        alerts_created: alertsCreated,
        results,
      },
    })
  } catch (err) {
    sendEvent({
      step: steps[currentStep] || 'unknown',
      status: 'error',
      error: (err as Error).message,
    })
  } finally {
    res.end()
  }
})

/**
 * GET /api/bandi/status
 * Returns the last sync metadata for bandi sources
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    const { data } = await supabase
      .from('sync_metadata')
      .select('*')
      .in('source', ['anac', 'ted', 'bandi-match'])
      .order('last_synced_at', { ascending: false })

    return res.json({ success: true, syncs: data || [] })
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
})

export default router
