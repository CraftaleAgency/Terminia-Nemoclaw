// ─── NemoClaw Orchestrator ────────────────────────────────────────────────────
// The brain of Terminia. Takes a user message, classifies intent via LLM,
// executes the right tools (Supabase queries, OSINT, alert management, etc.),
// then generates a final response with real data.
//
// Used by: chat route (dashboard + Telegram)
// Pattern: Intent classification → Tool execution → Response generation
// ────────────────────────────────────────────────────────────────────────────

import supabase from './supabase.ts'
import { chatCompletion } from './inference.ts'
import { runFullOSINT } from './osint.ts'

// ═══════════════════════════════════════════════════════════════════════════
// Tool definitions — what the orchestrator can do
// ═══════════════════════════════════════════════════════════════════════════

const TOOL_CATALOG = `Strumenti disponibili (rispondi con un JSON array di tool calls):

QUERY DATI:
- list_contracts: { filters?: { status?: "active"|"expiring"|"expired"|"draft", risk_min?: number, search?: string }, limit?: number }
- get_contract: { id?: string, search?: string }
- list_counterparts: { filters?: { unverified_only?: boolean, search?: string }, limit?: number }
- get_counterpart: { id?: string, search?: string }
- list_invoices: { filters?: { status?: "pending"|"paid"|"overdue", direction?: "in"|"out" }, limit?: number }
- list_alerts: { filters?: { resolved?: boolean, type?: string }, limit?: number }
- list_bandi: { filters?: { search?: string, min_score?: number }, limit?: number }
- list_employees: { filters?: { search?: string }, limit?: number }
- get_analytics: {}

AZIONI:
- verify_osint: { vat_number?: string, fiscal_code?: string, company_name?: string, counterpart_id?: string }
- resolve_alert: { alert_id: string }
- create_alert: { title: string, message: string, type: string, priority?: "low"|"normal"|"urgent" }
- search_bandi_external: { query: string, cpv?: string, region?: string }
- update_contract_status: { contract_id: string, status: "active"|"suspended"|"terminated" }
- update_invoice_status: { invoice_id: string, status: "paid"|"overdue" }

NESSUNA AZIONE NECESSARIA:
- none: {} (per domande informative, consulenza legale, spiegazioni — rispondi direttamente)`

const INTENT_PROMPT = `Sei l'orchestratore NemoClaw di Terminia. Analizza il messaggio dell'utente e decidi quali strumenti usare.

${TOOL_CATALOG}

Rispondi ESCLUSIVAMENTE con un JSON valido:
{
  "tools": [
    { "name": "nome_tool", "params": { ... } }
  ],
  "reasoning": "breve spiegazione del perché hai scelto questi tool"
}

Se l'utente chiede informazioni generiche, consulenza legale, o spiegazioni, usa:
{ "tools": [{ "name": "none", "params": {} }], "reasoning": "domanda informativa" }

Se servono più tool, elencali tutti. Esempio: "verifica la controparte e mostrami i contratti con lei" → verify_osint + list_contracts con search.`

// ═══════════════════════════════════════════════════════════════════════════
// Tool execution
// ═══════════════════════════════════════════════════════════════════════════

interface ToolCall {
  name: string
  params: Record<string, unknown>
}

interface ToolResult {
  tool: string
  success: boolean
  data: unknown
  error?: string
}

type ToolExecutor = (params: Record<string, unknown>, companyId: string) => Promise<ToolResult>

const toolExecutors: Record<string, ToolExecutor> = {

  // ── Query tools ─────────────────────────────────────────────────────────

  async list_contracts(params, companyId) {
    const filters = (params.filters || {}) as Record<string, unknown>
    const limit = (params.limit as number) || 20

    let query = supabase
      .from('contracts')
      .select('id, title, counterpart_name, status, expiration_date, risk_score, risk_level, contract_value, contract_type, signing_date, start_date, end_date')
      .eq('company_id', companyId)

    if (filters.status) query = query.eq('status', filters.status as string)
    if (filters.risk_min) query = query.gte('risk_score', filters.risk_min as number)
    if (filters.search) {
      query = query.or(`title.ilike.%${filters.search}%,counterpart_name.ilike.%${filters.search}%`)
    }

    const { data, error } = await query.order('expiration_date', { ascending: true }).limit(limit)
    if (error) return { tool: 'list_contracts', success: false, data: null, error: error.message }
    return { tool: 'list_contracts', success: true, data: { contracts: data, count: data?.length || 0 } }
  },

  async get_contract(params, companyId) {
    if (params.id) {
      const { data, error } = await supabase
        .from('contracts')
        .select('*, clauses(*), obligations(*), milestones(*)')
        .eq('id', params.id as string)
        .eq('company_id', companyId)
        .single()
      if (error) return { tool: 'get_contract', success: false, data: null, error: error.message }
      return { tool: 'get_contract', success: true, data }
    }
    if (params.search) {
      const { data, error } = await supabase
        .from('contracts')
        .select('id, title, counterpart_name, status, risk_score, contract_value')
        .eq('company_id', companyId)
        .or(`title.ilike.%${params.search}%,counterpart_name.ilike.%${params.search}%`)
        .limit(5)
      if (error) return { tool: 'get_contract', success: false, data: null, error: error.message }
      return { tool: 'get_contract', success: true, data }
    }
    return { tool: 'get_contract', success: false, data: null, error: 'Specifica id o search' }
  },

  async list_counterparts(params, companyId) {
    const filters = (params.filters || {}) as Record<string, unknown>
    const limit = (params.limit as number) || 20

    let query = supabase
      .from('counterparts')
      .select('id, name, vat_number, fiscal_code, reliability_score, osint_verified, osint_last_check, category, role')
      .eq('company_id', companyId)

    if (filters.unverified_only) query = query.or('osint_verified.is.null,osint_verified.eq.false')
    if (filters.search) {
      query = query.or(`name.ilike.%${filters.search}%,vat_number.ilike.%${filters.search}%`)
    }

    const { data, error } = await query.order('reliability_score', { ascending: true, nullsFirst: false }).limit(limit)
    if (error) return { tool: 'list_counterparts', success: false, data: null, error: error.message }
    return { tool: 'list_counterparts', success: true, data: { counterparts: data, count: data?.length || 0 } }
  },

  async get_counterpart(params, companyId) {
    if (params.id) {
      const { data, error } = await supabase
        .from('counterparts')
        .select('*')
        .eq('id', params.id as string)
        .eq('company_id', companyId)
        .single()
      if (error) return { tool: 'get_counterpart', success: false, data: null, error: error.message }
      return { tool: 'get_counterpart', success: true, data }
    }
    if (params.search) {
      const { data, error } = await supabase
        .from('counterparts')
        .select('id, name, vat_number, fiscal_code, reliability_score, osint_verified')
        .eq('company_id', companyId)
        .or(`name.ilike.%${params.search}%,vat_number.ilike.%${params.search}%,fiscal_code.ilike.%${params.search}%`)
        .limit(5)
      if (error) return { tool: 'get_counterpart', success: false, data: null, error: error.message }
      return { tool: 'get_counterpart', success: true, data }
    }
    return { tool: 'get_counterpart', success: false, data: null, error: 'Specifica id o search' }
  },

  async list_invoices(params, companyId) {
    const filters = (params.filters || {}) as Record<string, unknown>
    const limit = (params.limit as number) || 20

    let query = supabase
      .from('invoices')
      .select('id, invoice_number, counterpart_name, amount, due_date, status, direction, issue_date')
      .eq('company_id', companyId)

    if (filters.status) query = query.eq('status', filters.status as string)
    if (filters.direction) query = query.eq('direction', filters.direction as string)

    const { data, error } = await query.order('due_date', { ascending: true }).limit(limit)
    if (error) return { tool: 'list_invoices', success: false, data: null, error: error.message }
    return { tool: 'list_invoices', success: true, data: { invoices: data, count: data?.length || 0 } }
  },

  async list_alerts(params, companyId) {
    const filters = (params.filters || {}) as Record<string, unknown>
    const limit = (params.limit as number) || 20

    let query = supabase
      .from('alerts')
      .select('id, title, description, type, severity, created_at, resolved, related_entity_type, related_entity_id')
      .eq('company_id', companyId)

    if (filters.resolved !== undefined) query = query.eq('resolved', filters.resolved as boolean)
    if (filters.type) query = query.eq('type', filters.type as string)

    const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
    if (error) return { tool: 'list_alerts', success: false, data: null, error: error.message }
    return { tool: 'list_alerts', success: true, data: { alerts: data, count: data?.length || 0 } }
  },

  async list_bandi(params, companyId) {
    const filters = (params.filters || {}) as Record<string, unknown>
    const limit = (params.limit as number) || 20

    let query = supabase
      .from('bandi')
      .select('id, title, stazione_appaltante, importo, scadenza, source, cpv_codes, match_score, status, description')
      .eq('company_id', companyId)
      .eq('is_active', true)

    if (filters.search) {
      query = query.or(`title.ilike.%${filters.search}%,description.ilike.%${filters.search}%,stazione_appaltante.ilike.%${filters.search}%`)
    }
    if (filters.min_score) query = query.gte('match_score', filters.min_score as number)

    const { data, error } = await query.order('match_score', { ascending: false, nullsFirst: false }).limit(limit)
    if (error) return { tool: 'list_bandi', success: false, data: null, error: error.message }
    return { tool: 'list_bandi', success: true, data: { bandi: data, count: data?.length || 0 } }
  },

  async list_employees(params, companyId) {
    const filters = (params.filters || {}) as Record<string, unknown>
    const limit = (params.limit as number) || 20

    let query = supabase
      .from('employees')
      .select('id, name, role, contract_type, hire_date, contract_expiry, department, salary')
      .eq('company_id', companyId)

    if (filters.search) {
      query = query.or(`name.ilike.%${filters.search}%,role.ilike.%${filters.search}%`)
    }

    const { data, error } = await query.order('name').limit(limit)
    if (error) return { tool: 'list_employees', success: false, data: null, error: error.message }
    return { tool: 'list_employees', success: true, data: { employees: data, count: data?.length || 0 } }
  },

  async get_analytics(_params, companyId) {
    const [contractsRes, invoicesRes, counterpartsRes, alertsRes, bandiRes] = await Promise.all([
      supabase.from('contracts').select('status, risk_level, contract_value, risk_score').eq('company_id', companyId),
      supabase.from('invoices').select('status, amount, direction, due_date').eq('company_id', companyId),
      supabase.from('counterparts').select('reliability_score, osint_verified').eq('company_id', companyId),
      supabase.from('alerts').select('id, severity, resolved').eq('company_id', companyId),
      supabase.from('bandi').select('id, match_score, is_active').eq('company_id', companyId),
    ])

    const contracts = contractsRes.data || []
    const invoices = invoicesRes.data || []
    const counterparts = counterpartsRes.data || []
    const alerts = alertsRes.data || []
    const bandi = bandiRes.data || []

    const today = new Date().toISOString().split('T')[0]

    return {
      tool: 'get_analytics',
      success: true,
      data: {
        contracts: {
          total: contracts.length,
          active: contracts.filter(c => c.status === 'active' || c.status === 'expiring').length,
          expiring: contracts.filter(c => c.status === 'expiring').length,
          high_risk: contracts.filter(c => c.risk_level === 'high' || c.risk_level === 'critical').length,
          total_value: contracts.reduce((s, c) => s + (c.contract_value || 0), 0),
          avg_risk: contracts.length ? Math.round(contracts.reduce((s, c) => s + (c.risk_score || 0), 0) / contracts.length) : 0,
        },
        invoices: {
          total: invoices.length,
          pending: invoices.filter(i => i.status === 'pending').length,
          overdue: invoices.filter(i => i.status === 'overdue' || (i.status === 'pending' && i.due_date && i.due_date < today)).length,
          total_receivable: invoices.filter(i => i.direction === 'in' && i.status !== 'paid').reduce((s, i) => s + (i.amount || 0), 0),
          total_payable: invoices.filter(i => i.direction === 'out' && i.status !== 'paid').reduce((s, i) => s + (i.amount || 0), 0),
        },
        counterparts: {
          total: counterparts.length,
          verified: counterparts.filter(c => c.osint_verified).length,
          unverified: counterparts.filter(c => !c.osint_verified).length,
          avg_reliability: counterparts.length ? Math.round(counterparts.reduce((s, c) => s + (c.reliability_score || 0), 0) / counterparts.length) : 0,
        },
        alerts: {
          total: alerts.length,
          active: alerts.filter(a => !a.resolved).length,
          urgent: alerts.filter(a => !a.resolved && a.severity === 'urgent').length,
        },
        bandi: {
          total: bandi.length,
          active: bandi.filter(b => b.is_active).length,
          high_match: bandi.filter(b => b.is_active && (b.match_score || 0) >= 70).length,
        },
      },
    }
  },

  // ── Action tools ────────────────────────────────────────────────────────

  async verify_osint(params, companyId) {
    try {
      // Resolve counterpart_id if not provided
      let counterpartId = params.counterpart_id as string | undefined
      if (!counterpartId && (params.vat_number || params.company_name)) {
        const searchField = params.vat_number ? 'vat_number' : 'name'
        const searchValue = (params.vat_number || params.company_name) as string
        const { data: existing } = await supabase
          .from('counterparts')
          .select('id')
          .eq('company_id', companyId)
          .ilike(searchField, `%${searchValue}%`)
          .limit(1)
          .maybeSingle()
        if (existing) counterpartId = existing.id
      }

      const result = await runFullOSINT({
        vat_number: params.vat_number as string | undefined,
        fiscal_code: params.fiscal_code as string | undefined,
        company_name: params.company_name as string | undefined,
        counterpart_id: counterpartId,
        company_id: companyId,
      })
      return { tool: 'verify_osint', success: true, data: result }
    } catch (err) {
      return { tool: 'verify_osint', success: false, data: null, error: (err as Error).message }
    }
  },

  async resolve_alert(params, companyId) {
    const { error } = await supabase
      .from('alerts')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq('id', params.alert_id as string)
      .eq('company_id', companyId)
    if (error) return { tool: 'resolve_alert', success: false, data: null, error: error.message }
    return { tool: 'resolve_alert', success: true, data: { resolved: true, alert_id: params.alert_id } }
  },

  async create_alert(params, companyId) {
    const { data, error } = await supabase
      .from('alerts')
      .insert({
        company_id: companyId,
        title: params.title as string,
        message: params.message as string,
        type: params.type as string || 'custom',
        priority: params.priority as string || 'normal',
        created_at: new Date().toISOString(),
      })
      .select('id, title')
      .single()
    if (error) return { tool: 'create_alert', success: false, data: null, error: error.message }
    return { tool: 'create_alert', success: true, data }
  },

  async search_bandi_external(params, companyId) {
    // Search ANAC OCDS for matching bandi
    const query = params.query as string
    const from = new Date(Date.now() - 90 * 86400000).toISOString().split('T')[0]
    const to = new Date().toISOString().split('T')[0]

    try {
      const url = new URL('https://dati.anticorruzione.it/opendata/ocds/api/records')
      url.searchParams.set('releaseDate_from', from)
      url.searchParams.set('releaseDate_to', to)
      url.searchParams.set('page', '0')
      url.searchParams.set('size', '20')
      if (params.cpv) url.searchParams.set('cpv', params.cpv as string)
      if (params.region) url.searchParams.set('region', params.region as string)

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) })
      if (!res.ok) throw new Error(`ANAC ${res.status}`)
      const data = await res.json() as { records?: unknown[]; totalCount?: number }

      return {
        tool: 'search_bandi_external',
        success: true,
        data: { results: (data.records || []).slice(0, 10), total: data.totalCount || 0, source: 'ANAC OCDS' },
      }
    } catch (err) {
      return { tool: 'search_bandi_external', success: false, data: null, error: (err as Error).message }
    }
  },

  async update_contract_status(params, companyId) {
    const { error } = await supabase
      .from('contracts')
      .update({ status: params.status as string, updated_at: new Date().toISOString() })
      .eq('id', params.contract_id as string)
      .eq('company_id', companyId)
    if (error) return { tool: 'update_contract_status', success: false, data: null, error: error.message }
    return { tool: 'update_contract_status', success: true, data: { updated: true, contract_id: params.contract_id, new_status: params.status } }
  },

  async update_invoice_status(params, companyId) {
    const updates: Record<string, unknown> = {
      status: params.status as string,
      updated_at: new Date().toISOString(),
    }
    if (params.status === 'paid') updates.paid_date = new Date().toISOString()

    const { error } = await supabase
      .from('invoices')
      .update(updates)
      .eq('id', params.invoice_id as string)
      .eq('company_id', companyId)
    if (error) return { tool: 'update_invoice_status', success: false, data: null, error: error.message }
    return { tool: 'update_invoice_status', success: true, data: { updated: true, invoice_id: params.invoice_id, new_status: params.status } }
  },

  async none() {
    return { tool: 'none', success: true, data: null }
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// Orchestrator core
// ═══════════════════════════════════════════════════════════════════════════

interface OrchestratorResult {
  toolResults: ToolResult[]
  contextBlock: string
}

/**
 * Classify user intent via LLM and execute tools.
 * Returns tool results + formatted context for the response LLM pass.
 */
export async function orchestrate(
  userMessage: string,
  companyId: string,
  conversationContext?: string,
): Promise<OrchestratorResult> {
  // ── Step 1: Intent classification ───────────────────────────────────────
  let toolCalls: ToolCall[] = []

  try {
    const classifyMessages = [
      { role: 'system' as const, content: INTENT_PROMPT },
    ]
    if (conversationContext) {
      classifyMessages.push({ role: 'user' as const, content: `Contesto conversazione recente:\n${conversationContext}` })
    }
    classifyMessages.push({ role: 'user' as const, content: userMessage })

    const raw = await chatCompletion({
      model: 'nemotron-nano',
      messages: classifyMessages,
      temperature: 0.1,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    })

    // Parse tool calls
    let cleaned = raw.trim()
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    }
    const parsed = JSON.parse(cleaned) as { tools?: ToolCall[] }
    toolCalls = parsed.tools || []
  } catch {
    // If classification fails, fall back to no tools
    toolCalls = [{ name: 'none', params: {} }]
  }

  // ── Step 2: Execute tools ─────────────────────────────────────────────
  const results: ToolResult[] = []

  for (const call of toolCalls) {
    if (call.name === 'none') continue

    const executor = toolExecutors[call.name]
    if (!executor) {
      results.push({ tool: call.name, success: false, data: null, error: `Tool sconosciuto: ${call.name}` })
      continue
    }

    try {
      const result = await executor(call.params || {}, companyId)
      results.push(result)
    } catch (err) {
      results.push({ tool: call.name, success: false, data: null, error: (err as Error).message })
    }
  }

  // ── Step 3: Format context ────────────────────────────────────────────
  let contextBlock = ''
  if (results.length > 0) {
    const sections = results.map(r => {
      if (!r.success) return `[ERRORE: ${r.tool}] ${r.error}`
      const json = JSON.stringify(r.data, null, 2)
      // Truncate very large results
      const truncated = json.length > 4000 ? json.slice(0, 4000) + '\n... (troncato)' : json
      return `[RISULTATO: ${r.tool}]\n${truncated}`
    })

    contextBlock = `\n\n--- DATI DALLA PIATTAFORMA (risultati reali) ---\n${sections.join('\n\n')}\n--- FINE DATI ---\n\nIstruzioni: Usa QUESTI dati reali per rispondere. Cita nomi, importi, date, punteggi specifici. NON inventare dati aggiuntivi. Se un'azione è stata eseguita (resolve_alert, update_*), conferma all'utente.`
  }

  return { toolResults: results, contextBlock }
}
