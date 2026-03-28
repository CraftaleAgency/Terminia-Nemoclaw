#!/usr/bin/env -S node --experimental-strip-types
import { supabase } from '../../_shared/supabase-client.ts'
import { callInference, parseInferenceJSON, isoNow } from '../../_shared/utils.ts'

const MAX_TEXT_LENGTH = 8000;

const SYSTEM_PROMPT = `Sei un assistente legale specializzato nel diritto contrattuale italiano. Analizza il testo di un contratto e restituisci un JSON strutturato.

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
}`;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HandlerInput {
  text: string
  contract_id?: string
  company_id: string
}

interface CounterpartData {
  name: string
  vat?: string
  cf?: string
  role?: string
}

interface ClassificationParties {
  company?: string
  counterpart?: CounterpartData
}

interface Classification {
  contract_type: string
  counterpart_type: string | null
  language: string | null
  confidence: number
  parties: ClassificationParties | null
  summary_it: string | null
  counterpart_id?: string
  counterpart_error?: string
  error?: string
}

/**
 * Find an existing counterpart or create a new one.
 * Returns the counterpart id.
 */
async function findOrCreateCounterpart(companyId: string, counterpartData: CounterpartData): Promise<string> {
  const { name, vat, cf } = counterpartData;

  // Search by VAT number first, then fiscal code
  if (vat) {
    const { data } = await supabase
      .from('counterparts')
      .select('id')
      .eq('company_id', companyId)
      .eq('vat_number', vat)
      .maybeSingle();
    if (data) return data.id;
  }

  if (cf) {
    const { data } = await supabase
      .from('counterparts')
      .select('id')
      .eq('company_id', companyId)
      .eq('fiscal_code', cf)
      .maybeSingle();
    if (data) return data.id;
  }

  // Not found — insert new counterpart (with TOCTOU conflict retry)
  const { data: inserted, error } = await supabase
    .from('counterparts')
    .insert({
      company_id: companyId,
      name,
      vat_number: vat || null,
      fiscal_code: cf || null,
      role: counterpartData.role || null,
      created_at: isoNow(),
      updated_at: isoNow(),
    })
    .select('id')
    .single();

  if (error) {
    // Race: another request may have inserted the same counterpart — retry lookup
    if (vat) {
      const { data } = await supabase
        .from('counterparts')
        .select('id')
        .eq('company_id', companyId)
        .eq('vat_number', vat)
        .maybeSingle();
      if (data) return data.id;
    }
    if (cf) {
      const { data } = await supabase
        .from('counterparts')
        .select('id')
        .eq('company_id', companyId)
        .eq('fiscal_code', cf)
        .maybeSingle();
      if (data) return data.id;
    }
    throw new Error(`Failed to create counterpart: ${error.message}`);
  }
  return inserted.id;
}

/**
 * Classify an Italian contract via AI inference.
 */
async function handler(input: HandlerInput): Promise<Classification> {
  const { text, contract_id, company_id } = input;

  if (!text) throw new Error('Missing required field: text');
  if (!company_id) throw new Error('Missing required field: company_id');

  const userMessage = text.length > MAX_TEXT_LENGTH
    ? text.slice(0, MAX_TEXT_LENGTH)
    : text;

  let classification: Classification;
  try {
    const raw = await callInference(SYSTEM_PROMPT, userMessage);
    classification = parseInferenceJSON(raw) as Classification;
  } catch (err: unknown) {
    return {
      contract_type: 'altro',
      counterpart_type: null,
      language: null,
      confidence: 0,
      parties: null,
      summary_it: null,
      error: `Inference failed: ${(err as Error).message}`,
    };
  }

  // --- Persist classification to the contracts table ---
  if (contract_id) {
    const updates: Record<string, unknown> = {
      contract_type: classification.contract_type,
      counterpart_type: classification.counterpart_type,
      updated_at: isoNow(),
    };

    // Only advance status if still in initial state
    const { data: current } = await supabase
      .from('contracts')
      .select('status')
      .eq('id', contract_id)
      .maybeSingle();

    if (!current?.status || current.status === 'uploaded') {
      updates.status = 'classified';
    }

    await supabase
      .from('contracts')
      .update(updates)
      .eq('id', contract_id);
  }

  // --- Find or create counterpart ---
  const cp = classification.parties?.counterpart;
  if (cp?.name && (cp.vat || cp.cf)) {
    try {
      const counterpartId = await findOrCreateCounterpart(company_id, cp);

      if (contract_id) {
        await supabase
          .from('contracts')
          .update({ counterpart_id: counterpartId, updated_at: isoNow() })
          .eq('id', contract_id);
      }

      classification.counterpart_id = counterpartId;
    } catch (err: unknown) {
      classification.counterpart_error = (err as Error).message;
    }
  }

  return classification;
}

// CLI entry point
async function main(): Promise<void> {
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input: HandlerInput = JSON.parse(raw);
    const result = await handler(input);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err: unknown) {
    console.log(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }
}

main();
