import type { Request, Response } from 'express'
import type {
  AnalyzeContractRequest,
  AnalyzeContractResponse,
  ContractClassification,
  ContractExtraction,
  ContractRisk,
  CounterpartInfo,
} from '../types.ts'
import { Router } from 'express'
import supabase from '../lib/supabase.ts'
import { chatCompletion, parseInferenceJSON } from '../lib/inference.ts'

const router = Router()

const MAX_TEXT_LENGTH = 12000

// ── System prompts ──────────────────────────────────────────────────────────

const CLASSIFY_PROMPT = `Sei un assistente legale specializzato nel diritto contrattuale italiano. Analizza il testo di un contratto e restituisci un JSON strutturato.

Classifica il contratto in uno di questi tipi:
- "appalto_servizi" — Appalto di servizi
- "appalto_lavori" — Appalto di lavori
- "fornitura" — Contratto di fornitura
- "consulenza" — Contratto di consulenza/collaborazione
- "licenza_software" — Licenza o SaaS
- "locazione" — Locazione/affitto
- "lavoro_subordinato" — Contratto di lavoro subordinato
- "lavoro_determinato" — Contratto a tempo determinato
- "somministrazione" — Somministrazione di lavoro
- "collaborazione" — Co.Co.Co. o collaborazione
- "nda" — Accordo di riservatezza
- "framework" — Accordo quadro
- "altro" — Altro tipo

Identifica il tipo di controparte:
- "fornitore" — Fornitore
- "cliente" — Cliente
- "partner" — Partner commerciale
- "dipendente" — Dipendente/collaboratore
- "locatore" — Proprietario/locatore
- "ente_pubblico" — Ente pubblico/PA

Rispondi ESCLUSIVAMENTE con un JSON valido, senza spiegazioni:
{
  "contract_type": "...",
  "counterpart_type": "...",
  "language": "it|en|...",
  "confidence": 0.0-1.0,
  "parties": {
    "company": "ragione sociale dell'azienda committente/cliente",
    "counterpart": {
      "name": "ragione sociale o nome controparte",
      "vat": "P.IVA se presente (solo numeri)",
      "cf": "Codice Fiscale se presente",
      "role": "ruolo nel contratto"
    }
  },
  "summary_it": "Breve riassunto in italiano del contratto (max 2 frasi)"
}`

const EXTRACT_PROMPT = `Sei un assistente legale specializzato nell'analisi contrattuale italiana. Estrai tutti i dati strutturati dal seguente contratto.

Rispondi ESCLUSIVAMENTE con un JSON valido:
{
  "dates": {
    "start_date": "YYYY-MM-DD o null",
    "end_date": "YYYY-MM-DD o null",
    "signing_date": "YYYY-MM-DD o null",
    "notice_period_days": numero o null
  },
  "value": {
    "total_value": numero o null,
    "currency": "EUR",
    "payment_terms_days": numero o null,
    "payment_method": "stringa o null"
  },
  "renewal": {
    "auto_renewal": true/false,
    "renewal_notice_days": numero o null,
    "max_renewals": numero o null,
    "renewal_duration_months": numero o null
  },
  "clauses": [
    {
      "clause_type": "penale|riservatezza|non_compete|limitazione_responsabilita|proprieta_intellettuale|recesso|foro_competente|forza_maggiore|garanzia|altro",
      "title": "Titolo della clausola",
      "summary_it": "Riassunto in italiano semplice",
      "risk_level": "low|medium|high|critical",
      "risk_reason": "Motivo del rischio se medium/high/critical, altrimenti null",
      "original_text": "Testo originale abbreviato (max 200 chars)"
    }
  ],
  "obligations": [
    {
      "description": "Descrizione dell'obbligo",
      "responsible_party": "company|counterpart",
      "deadline": "YYYY-MM-DD o null",
      "recurring": true/false,
      "frequency": "monthly|quarterly|yearly|once o null"
    }
  ],
  "milestones": [
    {
      "title": "Nome milestone",
      "due_date": "YYYY-MM-DD o null",
      "amount": numero o null,
      "description": "Descrizione"
    }
  ]
}`

const RISK_PROMPT = `Sei un consulente legale italiano specializzato nell'analisi del rischio contrattuale. Analizza il contratto e le clausole estratte. Valuta clausole penali, rinnovi automatici, limitazioni di responsabilità, proprietà intellettuale, foro competente e ogni aspetto critico.

Rispondi ESCLUSIVAMENTE con un JSON valido:
{
  "risk_score": 0-100,
  "risk_label": "low|medium|high|critical",
  "dimensions": {
    "clausole_penali": { "score": 0-20, "note": "..." },
    "rinnovo_automatico": { "score": 0-15, "note": "..." },
    "limitazione_responsabilita": { "score": 0-15, "note": "..." },
    "proprieta_intellettuale": { "score": 0-15, "note": "..." },
    "termini_pagamento": { "score": 0-10, "note": "..." },
    "foro_competente": { "score": 0-10, "note": "..." },
    "obblighi_e_scadenze": { "score": 0-15, "note": "..." }
  },
  "top_risks": [
    { "title": "Titolo rischio", "description": "Spiegazione breve", "severity": "high|critical" }
  ],
  "recommendations_it": ["Raccomandazione 1", "Raccomandazione 2"]
}`

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoNow(): string {
  return new Date().toISOString()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

async function findOrCreateCounterpart(companyId: string, cp: CounterpartInfo): Promise<string> {
  const { name, vat, cf } = cp

  if (vat) {
    const { data } = await supabase
      .from('counterparts')
      .select('id')
      .eq('company_id', companyId)
      .eq('vat_number', vat)
      .maybeSingle()
    if (data) return data.id
  }

  if (cf) {
    const { data } = await supabase
      .from('counterparts')
      .select('id')
      .eq('company_id', companyId)
      .eq('fiscal_code', cf)
      .maybeSingle()
    if (data) return data.id
  }

  const { data: inserted, error } = await supabase
    .from('counterparts')
    .insert({
      company_id: companyId,
      name: name!,
      vat_number: vat || null,
      fiscal_code: cf || null,
      role: cp.role || null,
      created_at: isoNow(),
      updated_at: isoNow(),
    })
    .select('id')
    .single()

  if (error) {
    // Race condition retry
    if (vat) {
      const { data } = await supabase.from('counterparts').select('id')
        .eq('company_id', companyId).eq('vat_number', vat).maybeSingle()
      if (data) return data.id
    }
    throw new Error(`Failed to create counterpart: ${error.message}`)
  }
  return inserted.id
}

// ── Route handler ───────────────────────────────────────────────────────────

router.post('/', async (req: Request<object, AnalyzeContractResponse, AnalyzeContractRequest>, res: Response) => {
  const { document_text, document_base64, content_type, company_id, contract_id } = req.body

  if (!company_id) {
    return res.status(400).json({ error: 'company_id è obbligatorio' })
  }

  let text = document_text || ''

  // If base64 document provided and no text, attempt OCR via numarkdown
  if (!text && document_base64) {
    try {
      const ocrResult = await chatCompletion({
        model: 'numarkdown',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Estrai tutto il testo da questo documento.' },
              {
                type: 'image_url',
                image_url: {
                  url: document_base64.startsWith('data:')
                    ? document_base64
                    : `data:${content_type || 'application/pdf'};base64,${document_base64}`,
                },
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 8192,
      })
      text = ocrResult
    } catch (err) {
      return res.status(422).json({ error: `OCR fallito: ${(err as Error).message}` })
    }
  }

  if (!text) {
    return res.status(400).json({ error: 'document_text o document_base64 è obbligatorio' })
  }

  const truncated = text.slice(0, MAX_TEXT_LENGTH)
  const errors: string[] = []

  // ── Step 1: Classify ──────────────────────────────────────────────────────
  let classification: ContractClassification
  try {
    const raw = await chatCompletion({
      messages: [
        { role: 'system', content: CLASSIFY_PROMPT },
        { role: 'user', content: truncated },
      ],
      response_format: { type: 'json_object' },
    })
    classification = parseInferenceJSON(raw) as ContractClassification
  } catch (err) {
    classification = {
      contract_type: 'altro',
      counterpart_type: null,
      confidence: 0,
      parties: null,
      summary_it: null,
    }
    errors.push(`Classificazione fallita: ${(err as Error).message}`)
  }

  // Persist classification
  if (contract_id) {
    try {
      const updates: Record<string, unknown> = {
        contract_type: classification.contract_type,
        counterpart_type: classification.counterpart_type,
        updated_at: isoNow(),
      }
      const { data: current } = await supabase
        .from('contracts').select('status').eq('id', contract_id).maybeSingle()
      if (!current?.status || current.status === 'uploaded') {
        updates.status = 'classified'
      }
      await supabase.from('contracts').update(updates).eq('id', contract_id)
    } catch (err) {
      errors.push(`DB classificazione: ${(err as Error).message}`)
    }
  }

  // Find or create counterpart
  let counterpartId: string | null = null
  const cp = classification.parties?.counterpart
  if (cp?.name && (cp.vat || cp.cf)) {
    try {
      counterpartId = await findOrCreateCounterpart(company_id, cp)
      if (contract_id) {
        await supabase.from('contracts')
          .update({ counterpart_id: counterpartId, updated_at: isoNow() })
          .eq('id', contract_id)
      }
    } catch (err) {
      errors.push(`Controparte: ${(err as Error).message}`)
    }
  }

  // ── Step 2: Extract ───────────────────────────────────────────────────────
  let extraction: ContractExtraction
  try {
    const raw = await chatCompletion({
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: truncated },
      ],
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    })
    extraction = parseInferenceJSON(raw) as ContractExtraction
  } catch (err) {
    extraction = { dates: null, value: null, renewal: null, clauses: [], obligations: [], milestones: [] }
    errors.push(`Estrazione fallita: ${(err as Error).message}`)
  }

  // Persist extraction
  if (contract_id) {
    try {
      const { dates, value, renewal } = extraction
      await supabase.from('contracts').update({
        start_date: dates?.start_date || null,
        end_date: dates?.end_date || null,
        signing_date: dates?.signing_date || null,
        total_value: value?.total_value ?? null,
        currency: value?.currency || 'EUR',
        payment_terms_days: value?.payment_terms_days ?? null,
        auto_renewal: renewal?.auto_renewal ?? false,
        renewal_notice_days: renewal?.renewal_notice_days ?? null,
        status: 'extracted',
        updated_at: isoNow(),
      }).eq('id', contract_id)
    } catch (err) {
      errors.push(`DB estrazione: ${(err as Error).message}`)
    }

    // Clauses
    if (extraction.clauses?.length) {
      try {
        const now = isoNow()
        await supabase.from('clauses').insert(
          extraction.clauses.map(c => ({
            contract_id, company_id,
            clause_type: c.clause_type || 'altro',
            title: c.title || null,
            summary: c.summary_it || null,
            risk_level: c.risk_level || 'low',
            risk_reason: c.risk_reason || null,
            original_text: c.original_text?.slice(0, 200) || null,
            created_at: now,
          }))
        )
      } catch (err) {
        errors.push(`DB clausole: ${(err as Error).message}`)
      }
    }

    // Obligations
    if (extraction.obligations?.length) {
      try {
        const now = isoNow()
        await supabase.from('obligations').insert(
          extraction.obligations.map(o => ({
            contract_id, company_id,
            description: o.description || null,
            responsible_party: o.responsible_party || null,
            deadline: o.deadline || null,
            recurring: o.recurring ?? false,
            frequency: o.frequency || null,
            created_at: now,
          }))
        )
      } catch (err) {
        errors.push(`DB obblighi: ${(err as Error).message}`)
      }
    }

    // Milestones
    if (extraction.milestones?.length) {
      try {
        const now = isoNow()
        await supabase.from('milestones').insert(
          extraction.milestones.map(m => ({
            contract_id, company_id,
            title: m.title || null,
            due_date: m.due_date || null,
            amount: m.amount ?? null,
            description: m.description || null,
            created_at: now,
          }))
        )
      } catch (err) {
        errors.push(`DB milestones: ${(err as Error).message}`)
      }
    }
  }

  // ── Step 3: Risk Score ────────────────────────────────────────────────────
  let risk: ContractRisk
  try {
    const context = JSON.stringify({
      classification,
      dates: extraction.dates,
      value: extraction.value,
      renewal: extraction.renewal,
      clauses: extraction.clauses,
      obligations: extraction.obligations,
    })
    const raw = await chatCompletion({
      messages: [
        { role: 'system', content: RISK_PROMPT },
        { role: 'user', content: `Contratto:\n${truncated.slice(0, 4000)}\n\nDati estratti:\n${context}` },
      ],
      response_format: { type: 'json_object' },
    })
    risk = parseInferenceJSON(raw) as ContractRisk
    risk.risk_score = clamp(risk.risk_score ?? 0, 0, 100)
  } catch (err) {
    risk = { risk_score: null, risk_label: null, dimensions: null, top_risks: [], recommendations_it: [] }
    errors.push(`Rischio fallito: ${(err as Error).message}`)
  }

  // Persist risk
  if (contract_id && risk.risk_score != null) {
    try {
      await supabase.from('contracts').update({
        risk_score: risk.risk_score,
        risk_label: risk.risk_label,
        risk_details: { dimensions: risk.dimensions, top_risks: risk.top_risks } as unknown as string,
        status: 'analyzed',
        updated_at: isoNow(),
      }).eq('id', contract_id)
    } catch (err) {
      errors.push(`DB rischio: ${(err as Error).message}`)
    }

    // Create alerts for high-risk contracts
    if (risk.risk_score >= 70) {
      try {
        await supabase.from('alerts').insert({
          company_id,
          type: 'high_risk_contract',
          title: 'Contratto ad alto rischio rilevato',
          message: `Il contratto ha ottenuto un punteggio di rischio di ${risk.risk_score}/100. Si consiglia una revisione legale immediata.`,
          priority: 'urgent',
          related_entity_type: 'contract',
          related_entity_id: contract_id,
          created_at: isoNow(),
        })
      } catch {
        // non-fatal
      }
    }
  }

  // ── Response ──────────────────────────────────────────────────────────────
  const result: AnalyzeContractResponse & { warnings?: string[] } = {
    classification,
    extraction,
    risk,
    counterpart_id: counterpartId,
  }
  if (errors.length) result.warnings = errors

  res.json(result)
})

export default router
