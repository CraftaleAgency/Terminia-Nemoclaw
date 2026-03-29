import type { Request, Response } from 'express'
import type {
  AnalyzeContractRequest,
  AnalyzeContractResponse,
  ContractClassification,
  ContractExtraction,
  ContractRisk,
  CounterpartInfo,
  RegistrationProfile,
} from '../types.ts'
import { Router } from 'express'
import { createRequire } from 'module'
import mammoth from 'mammoth'
import supabase from '../lib/supabase.ts'
import { chatCompletion, parseInferenceJSON } from '../lib/inference.ts'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')

const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/tiff'])
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const REGISTRATION_MODEL = process.env.REGISTRATION_MODEL || 'nemotron-orchestrator'

const router = Router()

const MAX_TEXT_LENGTH = 12000
const FISCAL_CODE_REGEX = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/i
const VAT_LABEL_REGEX = /(?:PARTITA\s*IVA|P\.?\s*IVA|PIVA|VAT)\D{0,12}(\d{11})/i
const VAT_FALLBACK_REGEX = /\b\d{11}\b/
const REGISTRATION_SECTORS = [
  'Informatica e Tecnologia',
  'Manifatturiero',
  'Servizi Professionali',
  'Commercio',
  'Edilizia e Costruzioni',
  'Trasporti e Logistica',
  'Alimentare',
  'Sanitario',
  'Altro',
] as const

function cleanExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractLabeledValue(text: string, labels: string[]): string | null {
  const escaped = labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(?:${escaped.join('|')})\\s*[:\\-]?\\s*([^\\n]{3,120})`, 'i')
  const match = text.match(regex)
  return match?.[1]?.trim() || null
}

function extractCityFromText(text: string): string | null {
  const labeled = extractLabeledValue(text, [
    'Comune di residenza',
    'Città di residenza',
    'Residenza',
    'Residente a',
    'Comune',
    'Sede legale',
    'Sede',
    'Con sede in',
  ])
  if (labeled) {
    return labeled.split(/[,\n(]/)[0]?.trim() || null
  }

  const match = text.match(/\b(?:residente|residenza|con sede|sede legale|domiciliato)\s+(?:a|in)\s+([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ' -]{1,60})/i)
  return match?.[1]?.split(/[,\n(]/)[0]?.trim() || null
}

function extractFiscalCodeFromText(text: string): string | null {
  const upper = text.toUpperCase()
  const direct = upper.match(FISCAL_CODE_REGEX)?.[0]
  if (direct) return direct

  const collapsed = upper.replace(/[^A-Z0-9]/g, '')
  const collapsedMatch = collapsed.match(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/)?.[0]
  if (collapsedMatch) return collapsedMatch

  const labeled = extractLabeledValue(text, [
    'Codice fiscale',
    'CF',
    'Cod. Fisc.',
    'Codice Fiscale',
  ])
  if (!labeled) return null

  const normalized = labeled.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const labeledMatch = normalized.match(/[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]/)?.[0]
  return labeledMatch || null
}

function inferSectorFromText(text: string): string | null {
  const lower = text.toLowerCase()
  const sectorKeywords: [string, string][] = [
    ['informatica', 'Informatica e Tecnologia'],
    ['tecnologia', 'Informatica e Tecnologia'],
    ['software', 'Informatica e Tecnologia'],
    ['manifattura', 'Manifatturiero'],
    ['produzione', 'Manifatturiero'],
    ['consulenza', 'Servizi Professionali'],
    ['professionale', 'Servizi Professionali'],
    ['commercio', 'Commercio'],
    ['vendita', 'Commercio'],
    ['fornitura', 'Commercio'],
    ['edilizia', 'Edilizia e Costruzioni'],
    ['costruzione', 'Edilizia e Costruzioni'],
    ['appalto', 'Edilizia e Costruzioni'],
    ['trasporto', 'Trasporti e Logistica'],
    ['logistica', 'Trasporti e Logistica'],
    ['alimentare', 'Alimentare'],
    ['sanitario', 'Sanitario'],
    ['medico', 'Sanitario'],
  ]

  for (const [keyword, sector] of sectorKeywords) {
    if (lower.includes(keyword)) return sector
  }
  return null
}

function extractRegistrationProfileFallback(text: string): RegistrationProfile {
  const cleaned = cleanExtractedText(text)
  const upper = cleaned.toUpperCase()
  const fiscalCode = extractFiscalCodeFromText(cleaned) || ''
  const vat = upper.match(VAT_LABEL_REGEX)?.[1] || upper.match(VAT_FALLBACK_REGEX)?.[0] || ''
  const companyName = extractLabeledValue(cleaned, [
    'Denominazione',
    'Ragione sociale',
    'Company name',
    'Intestatario',
  ])
  const counterpartName = extractLabeledValue(cleaned, [
    'Cognome e nome',
    'Nome e cognome',
    'Titolare',
    'Intestato a',
    'Nominativo',
  ])
  const city = extractCityFromText(cleaned)
  const sector = inferSectorFromText(cleaned)

  const isPerson = Boolean(fiscalCode) && !companyName
  return {
    account_type_hint: isPerson ? 'person' : (companyName || vat ? 'company' : 'unknown'),
    document_kind: isPerson ? 'identity_or_personal_vat' : 'company_registration',
    full_name: counterpartName || null,
    company_name: companyName || null,
    fiscal_code: fiscalCode || null,
    vat_number: vat || null,
    city: city || null,
    sector,
    confidence: (fiscalCode || vat || companyName || city) ? 0.8 : 0.2,
  }
}

function mergeRegistrationProfile(
  fallback: RegistrationProfile,
  parsed: Partial<RegistrationProfile> | null | undefined,
): RegistrationProfile {
  const merged: RegistrationProfile = { ...fallback }
  if (!parsed) return merged

  if (parsed.account_type_hint === 'person' || parsed.account_type_hint === 'company' || parsed.account_type_hint === 'unknown') {
    merged.account_type_hint = parsed.account_type_hint
  }
  if (parsed.document_kind) merged.document_kind = String(parsed.document_kind).trim()
  if (parsed.full_name) merged.full_name = String(parsed.full_name).trim()
  if (parsed.company_name) merged.company_name = String(parsed.company_name).trim()
  if (parsed.city) merged.city = String(parsed.city).trim()
  if (parsed.sector && REGISTRATION_SECTORS.includes(parsed.sector as typeof REGISTRATION_SECTORS[number])) {
    merged.sector = parsed.sector
  }
  if (parsed.confidence != null && Number.isFinite(Number(parsed.confidence))) {
    merged.confidence = Number(parsed.confidence)
  }

  const fiscalCode = parsed.fiscal_code
    ? String(parsed.fiscal_code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
    : null
  if (fiscalCode) merged.fiscal_code = fiscalCode

  const vatNumber = parsed.vat_number
    ? String(parsed.vat_number).replace(/\D/g, '').slice(0, 11)
    : null
  if (vatNumber) merged.vat_number = vatNumber

  return merged
}

function classificationFromRegistrationProfile(profile: RegistrationProfile): ContractClassification {
  const summaryBits = [
    profile.fiscal_code ? `CF: ${profile.fiscal_code}` : null,
    profile.vat_number ? `P.IVA: ${profile.vat_number}` : null,
    profile.company_name ? `Azienda: ${profile.company_name}` : null,
    profile.full_name ? `Persona: ${profile.full_name}` : null,
    profile.city ? `Città: ${profile.city}` : null,
    profile.sector ? `Settore: ${profile.sector}` : null,
  ].filter(Boolean)

  const isPerson = profile.account_type_hint === 'person'
    || (Boolean(profile.fiscal_code) && !profile.company_name)

  return {
    contract_type: profile.sector || (isPerson ? 'profilo_persona_fisica' : 'profilo_registrazione'),
    counterpart_type: isPerson ? 'persona_fisica' : 'azienda',
    language: 'it',
    confidence: profile.confidence ?? (summaryBits.length ? 0.9 : 0.2),
    parties: {
      company: profile.company_name || undefined,
      counterpart: {
        name: profile.full_name || profile.company_name || undefined,
        vat: profile.vat_number || undefined,
        cf: profile.fiscal_code || undefined,
        role: isPerson ? 'persona' : 'azienda',
      },
    },
    summary_it: summaryBits.length
      ? `Dati estratti dal documento di registrazione: ${summaryBits.join(', ')}.`
      : 'Documento acquisito ma senza identificativi chiari estraibili in automatico.',
  }
}

const REGISTRATION_PROMPT = `Estrai dati di registrazione da un documento italiano.
Rispondi SOLO con JSON:
{"account_type_hint":"person|company|unknown","document_kind":"identity_or_personal_vat|company_registration|unknown","full_name":null,"company_name":null,"fiscal_code":null,"vat_number":null,"city":null,"sector":null,"confidence":0}
Regole: niente testo extra; niente campi inventati; city=solo comune/citta; vat_number=11 cifre; fiscal_code=maiuscolo.`

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
  const { document_text, document_base64, content_type, company_id, contract_id, skip_persist } = req.body as AnalyzeContractRequest & { skip_persist?: boolean }

  if (!company_id && !skip_persist) {
    return res.status(400).json({ error: 'company_id è obbligatorio' })
  }

  let text = document_text || ''

  // If base64 document provided and no text, extract text
  if (!text && document_base64) {
    try {
      const raw = document_base64.startsWith('data:')
        ? document_base64.replace(/^data:[^;]+;base64,/, '')
        : document_base64
      const buffer = Buffer.from(raw, 'base64')
      const mime = (content_type || 'application/pdf').toLowerCase()

      if (IMAGE_MIMES.has(mime)) {
        // Image → vision OCR via numarkdown
        const dataUrl = `data:${mime};base64,${raw}`
        const ocrResult = await chatCompletion({
          model: 'numarkdown',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Estrai tutto il testo da questo documento.' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          }],
          temperature: 0.1,
          max_tokens: 8192,
        })
        text = ocrResult
      } else if (mime === DOCX_MIME) {
        // DOCX → extract text via mammoth
        const result = await mammoth.extractRawText({ buffer })
        text = result.value?.trim() || ''
      } else {
        // PDF / other docs → extract text directly
        const uint8 = new Uint8Array(buffer)
        const parser = new PDFParse(uint8)
        await parser.load()
        const result = await parser.getText()
        text = typeof result === 'string' ? result : (result?.text || '')
      }
    } catch (err) {
      return res.status(422).json({ error: `Estrazione testo fallita: ${(err as Error).message}` })
    }
  }

  if (!text) {
    return res.status(400).json({ error: 'document_text o document_base64 è obbligatorio' })
  }

  text = cleanExtractedText(text)
  const truncated = text.slice(0, MAX_TEXT_LENGTH)
  const errors: string[] = []

  if (skip_persist) {
    const registrationText = truncated.slice(0, 4000)
    const fallbackProfile = extractRegistrationProfileFallback(truncated)
    let registrationProfile = fallbackProfile

    try {
      const raw = await chatCompletion({
        model: REGISTRATION_MODEL,
        messages: [
          { role: 'system', content: REGISTRATION_PROMPT },
          { role: 'user', content: registrationText },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 180,
      })
      registrationProfile = mergeRegistrationProfile(
        fallbackProfile,
        parseInferenceJSON(raw) as Partial<RegistrationProfile>,
      )
    } catch (err) {
      errors.push(`Parsing registrazione AI fallito: ${(err as Error).message}`)
    }

    const classification = classificationFromRegistrationProfile(registrationProfile)
    if (!classification.parties?.company && !classification.parties?.counterpart?.vat && !classification.parties?.counterpart?.cf && !registrationProfile.city) {
      errors.push('Nessun identificativo chiaro trovato nel documento di registrazione')
    }

    const result: AnalyzeContractResponse = {
      classification,
      extraction: { dates: null, value: null, renewal: null, clauses: [], obligations: [], milestones: [] },
      risk: { risk_score: null, risk_label: null, dimensions: null, top_risks: [], recommendations_it: [] },
      counterpart_id: null,
      source_text: truncated,
      registration_profile: registrationProfile,
    }
    if (errors.length) result.warnings = errors
    return res.json(result)
  }

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
  if (contract_id && !skip_persist) {
    try {
      const updates: Record<string, unknown> = {
        contract_type: classification.contract_type,
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
  if (cp?.name && (cp.vat || cp.cf) && !skip_persist && company_id) {
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
  if (contract_id && !skip_persist) {
    try {
      const { dates, value, renewal } = extraction
      await supabase.from('contracts').update({
        start_date: dates?.start_date || null,
        end_date: dates?.end_date || null,
        signed_date: dates?.signing_date || null,
        value: value?.total_value ?? null,
        currency: value?.currency || 'EUR',
        payment_terms: value?.payment_terms_days ?? null,
        auto_renewal: renewal?.auto_renewal ?? false,
        renewal_notice_days: renewal?.renewal_notice_days ?? null,
        status: 'active',
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
            contract_id,
            clause_type: c.clause_type || 'other',
            original_text: c.original_text?.slice(0, 2000) || c.title || 'N/A',
            simplified_text: c.summary_it || null,
            risk_level: c.risk_level || 'low',
            risk_explanation: c.risk_reason || null,
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
            contract_id,
            description: o.description || 'N/A',
            party: o.responsible_party === 'controparte' ? 'theirs' : 'mine',
            due_date: o.deadline || null,
            recurrence: o.recurring ? (o.frequency || 'monthly') : null,
            status: 'pending',
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
            contract_id,
            title: m.title || 'Milestone',
            due_date: m.due_date || null,
            amount: m.amount ?? null,
            description: m.description || null,
            status: 'upcoming',
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
  if (contract_id && risk.risk_score != null && !skip_persist) {
    try {
      await supabase.from('contracts').update({
        risk_score: risk.risk_score,
        ai_summary: risk.recommendations_it?.join(' • ') || null,
        status: 'active',
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
          contract_id,
          alert_type: 'contract_expiry',
          title: 'Contratto ad alto rischio rilevato',
          description: `Il contratto ha ottenuto un punteggio di rischio di ${risk.risk_score}/100. Si consiglia una revisione legale immediata.`,
          priority: 'critical',
          trigger_date: isoNow(),
          triggered_at: isoNow(),
          status: 'pending',
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
