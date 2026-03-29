import type { Request, Response } from 'express'
import type { ChatRequest, ChatResponse } from '../types.ts'
import { Router } from 'express'
import supabase from '../lib/supabase.ts'
import { chatCompletion, chatCompletionStream } from '../lib/inference.ts'

const router = Router()

// ── Chat Tools — real Supabase queries the LLM can leverage ─────────────────

interface ToolResult {
  tool: string
  data: unknown
}

/**
 * Detect user intent from the latest message and pre-fetch relevant data.
 * This is a keyword + pattern approach — fast, deterministic, no extra LLM call.
 * Returns tool results to inject into the system context.
 */
async function executeTools(
  lastMessage: string,
  companyId: string | undefined,
): Promise<ToolResult[]> {
  if (!companyId) return []

  const msg = lastMessage.toLowerCase()
  const results: ToolResult[] = []

  // ── Contracts: expiring / scadenza ────────────────────────────────────────
  if (msg.match(/scaden|expir|rinnov|prossimi.*giorni|in scadenza|contratti.*attivi/)) {
    const { data } = await supabase
      .from('contracts')
      .select('id, title, counterpart_name, status, expiration_date, risk_score, contract_value')
      .eq('company_id', companyId)
      .in('status', ['active', 'expiring'])
      .order('expiration_date', { ascending: true })
      .limit(20)
    if (data?.length) results.push({ tool: 'contracts_expiring', data })
  }

  // ── Contracts: risk / rischio ─────────────────────────────────────────────
  if (msg.match(/rischi|risk|pericol|critic|alto rischio|portafoglio/)) {
    const { data } = await supabase
      .from('contracts')
      .select('id, title, counterpart_name, risk_score, risk_level, contract_value, status')
      .eq('company_id', companyId)
      .not('risk_score', 'is', null)
      .order('risk_score', { ascending: false })
      .limit(15)
    if (data?.length) results.push({ tool: 'contracts_risk', data })
  }

  // ── Contract detail: specific contract by name ────────────────────────────
  const contractNameMatch = msg.match(/contratto\s+(?:con\s+|di\s+|")?([a-zA-ZÀ-ú\s]{3,})/i)
  if (contractNameMatch) {
    const searchTerm = contractNameMatch[1].trim()
    const { data } = await supabase
      .from('contracts')
      .select('id, title, counterpart_name, status, expiration_date, risk_score, contract_value, contract_type, signing_date')
      .eq('company_id', companyId)
      .or(`title.ilike.%${searchTerm}%,counterpart_name.ilike.%${searchTerm}%`)
      .limit(5)
    if (data?.length) results.push({ tool: 'contract_search', data })
  }

  // ── OSINT: verify P.IVA / codice fiscale ──────────────────────────────────
  const pivaMatch = msg.match(/(?:p\.?\s?iva|partita\s?iva)[:\s]*([A-Z]{0,2}\d{9,11})/i)
  const cfMatch = msg.match(/(?:codice\s?fiscale|c\.?f\.?)[:\s]*([A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z])/i)
  if (pivaMatch || cfMatch) {
    // Look up if this counterpart already exists
    const searchValue = pivaMatch?.[1] || cfMatch?.[1]
    const { data } = await supabase
      .from('counterparts')
      .select('id, name, vat_number, fiscal_code, reliability_score, osint_verified, osint_last_check, category')
      .eq('company_id', companyId)
      .or(`vat_number.ilike.%${searchValue}%,fiscal_code.ilike.%${searchValue}%`)
      .limit(3)
    if (data?.length) {
      results.push({ tool: 'counterpart_lookup', data })
    } else {
      results.push({
        tool: 'counterpart_not_found',
        data: { searched: searchValue, hint: 'La controparte non è ancora registrata. L\'utente può aggiungerla nella sezione Controparti e lanciare la verifica OSINT.' },
      })
    }
  }

  // ── Counterparts: general ─────────────────────────────────────────────────
  if (msg.match(/contropart|fornitor|client[ei]|partner|affidabilit/)) {
    const { data } = await supabase
      .from('counterparts')
      .select('id, name, vat_number, reliability_score, osint_verified, category, osint_last_check')
      .eq('company_id', companyId)
      .order('reliability_score', { ascending: true, nullsFirst: false })
      .limit(15)
    if (data?.length) results.push({ tool: 'counterparts_list', data })
  }

  // ── Alerts ────────────────────────────────────────────────────────────────
  if (msg.match(/alert|notific|avvis|urgente|attenzione/)) {
    const { data } = await supabase
      .from('alerts')
      .select('id, title, description, type, severity, created_at, resolved')
      .eq('company_id', companyId)
      .eq('resolved', false)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data?.length) results.push({ tool: 'alerts_active', data })
  }

  // ── Bandi ─────────────────────────────────────────────────────────────────
  if (msg.match(/band[oi]|gara|appalto|ted|anac|cpv|opportunit/)) {
    const { data } = await supabase
      .from('bandi')
      .select('id, title, stazione_appaltante, importo, scadenza, source, cpv_codes, match_score, status')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('match_score', { ascending: false, nullsFirst: false })
      .limit(15)
    if (data?.length) results.push({ tool: 'bandi_list', data })
  }

  // ── Invoices / fatture ────────────────────────────────────────────────────
  if (msg.match(/fattur|invoice|pagament|incass|scadut[oae]|da pagare|insolut/)) {
    const { data } = await supabase
      .from('invoices')
      .select('id, invoice_number, counterpart_name, amount, due_date, status, direction, issue_date')
      .eq('company_id', companyId)
      .order('due_date', { ascending: true })
      .limit(20)
    if (data?.length) results.push({ tool: 'invoices_list', data })
  }

  // ── Employees / dipendenti ────────────────────────────────────────────────
  if (msg.match(/dipendent|personale|assunzion|contratt[oi]\s+di\s+lavor|ccnl|stipend/)) {
    const { data } = await supabase
      .from('employees')
      .select('id, name, role, contract_type, hire_date, contract_expiry, department')
      .eq('company_id', companyId)
      .order('name')
      .limit(20)
    if (data?.length) results.push({ tool: 'employees_list', data })
  }

  // ── Analytics / statistiche ───────────────────────────────────────────────
  if (msg.match(/statistic|analytic|riepilog|panoramic|sommario|overview|quanto|total/)) {
    const [contractStats, invoiceStats, counterpartStats] = await Promise.all([
      supabase
        .from('contracts')
        .select('status, risk_level, contract_value')
        .eq('company_id', companyId),
      supabase
        .from('invoices')
        .select('status, amount, direction')
        .eq('company_id', companyId),
      supabase
        .from('counterparts')
        .select('reliability_score, osint_verified')
        .eq('company_id', companyId),
    ])
    const contracts = contractStats.data || []
    const invoices = invoiceStats.data || []
    const cparts = counterpartStats.data || []

    const totalValue = contracts.reduce((s, c) => s + (c.contract_value || 0), 0)
    const activeContracts = contracts.filter(c => c.status === 'active' || c.status === 'expiring').length
    const highRisk = contracts.filter(c => c.risk_level === 'high' || c.risk_level === 'critical').length
    const invoicesDue = invoices.filter(i => i.status === 'pending' || i.status === 'overdue')
    const totalDue = invoicesDue.reduce((s, i) => s + (i.amount || 0), 0)
    const unverified = cparts.filter(c => !c.osint_verified).length

    results.push({
      tool: 'analytics_summary',
      data: {
        contracts: { total: contracts.length, active: activeContracts, highRisk, totalValue },
        invoices: { total: invoices.length, pending: invoicesDue.length, totalDue },
        counterparts: { total: cparts.length, unverified },
      },
    })
  }

  return results
}

/**
 * Format tool results as a context block for the LLM.
 */
function formatToolContext(results: ToolResult[]): string {
  if (!results.length) return ''

  const sections = results.map(r => {
    const json = JSON.stringify(r.data, null, 2)
    return `[DATI: ${r.tool}]\n${json}`
  })

  return `\n\n--- DATI REALI DALLA PIATTAFORMA ---\nI seguenti dati provengono dal database dell'azienda. Usali per rispondere con precisione. Cita i dati specifici (nomi, importi, date, punteggi) nella tua risposta. NON inventare dati aggiuntivi.\n\n${sections.join('\n\n')}\n--- FINE DATI ---`
}

// ── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sei Terminia AI, assistente legale e gestionale per PMI italiane. Rispondi in italiano, in modo professionale ma accessibile.

Le tue competenze:
- Analisi contratti e clausole
- Verifica affidabilità controparti (VIES, Codice Fiscale, ANAC)
- Scadenze e obblighi contrattuali
- Normativa italiana (Codice Civile, D.Lgs. 50/2016, GDPR)
- Bandi di gara e appalti pubblici
- Fatturazione e monitoraggio pagamenti
- Gestione dipendenti e contratti di lavoro
- Domande informative generali su diritto commerciale, tributario, del lavoro

Azioni che l'utente può fare nella piattaforma Terminia (suggeriscile quando pertinente):
- 📄 **Carica un contratto** → /dashboard/contracts/new → analisi automatica AI
- 🔍 **Verifica controparte** → /dashboard/counterparts/[id] → OSINT (VIES, CF, ANAC)
- 📊 **Dashboard** → /dashboard → panoramica generale
- ⚠️ **Alerts** → /dashboard/alerts → notifiche scadenze
- 🎯 **BandoRadar** → /dashboard/bandi → bandi ANAC + TED Europa
- 💰 **Fatture** → /dashboard/invoices → gestione fatture
- 👥 **Controparti** → /dashboard/counterparts → anagrafica
- 👤 **Dipendenti** → /dashboard/employees → contratti di lavoro
- 📈 **Analytics** → /dashboard/analytics → statistiche

Quando nella risposta trovi dati dalla piattaforma (blocco DATI REALI):
- Usa SEMPRE i dati reali, non inventare numeri
- Presenta i dati in modo chiaro con tabelle markdown o elenchi
- Evidenzia scadenze imminenti, rischi alti, pagamenti scaduti
- Suggerisci azioni concrete basate sui dati

Regole:
- Rispondi sempre in italiano
- Sii conciso ma preciso
- Cita articoli di legge quando rilevante
- Se non sei sicuro, dillo esplicitamente
- Non inventare dati o numeri
- Usa formato markdown per strutturare le risposte
- Per domande generiche/informative rispondi liberamente con le tue conoscenze`

router.post('/', async (req: Request<object, ChatResponse, ChatRequest>, res: Response) => {
  const { messages, company_id, stream } = req.body

  if (!messages?.length) {
    return res.status(400).json({ error: 'messages è obbligatorio' })
  }

  // Extract last user message for tool detection
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || ''

  // Execute relevant tools based on user intent
  let toolContext = ''
  try {
    const toolResults = await executeTools(lastUserMessage, company_id)
    toolContext = formatToolContext(toolResults)
  } catch {
    // non-fatal — proceed without tool data
  }

  // Build company context summary
  let contextNote = ''
  if (company_id && !toolContext) {
    // Only fetch summary counts if no tool data was fetched (avoids redundant queries)
    try {
      const [contracts, alerts, counterparts, expiring, bandi] = await Promise.all([
        supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('company_id', company_id),
        supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('resolved', false),
        supabase.from('counterparts').select('id', { count: 'exact', head: true }).eq('company_id', company_id),
        supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('status', 'expiring'),
        supabase.from('bandi').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('is_active', true),
      ])
      const parts: string[] = []
      if (contracts.count) parts.push(`${contracts.count} contratti`)
      if (expiring.count) parts.push(`${expiring.count} in scadenza`)
      if (counterparts.count) parts.push(`${counterparts.count} controparti`)
      if (alerts.count) parts.push(`${alerts.count} alert attivi`)
      if (bandi.count) parts.push(`${bandi.count} bandi attivi`)
      if (parts.length) {
        contextNote = `\n\nContesto azienda: ${parts.join(', ')}.`
      }
    } catch {
      // non-fatal
    }
  }

  const fullMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT + contextNote + toolContext },
    ...messages,
  ]

  // Non-streaming: return plain JSON response
  if (stream === false) {
    try {
      const content = await chatCompletion({ messages: fullMessages })
      return res.json({ content })
    } catch (err) {
      return res.status(502).json({ error: (err as Error).message })
    }
  }

  // SSE streaming response (default)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    for await (const chunk of chatCompletionStream({ messages: fullMessages })) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
  }

  res.end()
})

export default router
