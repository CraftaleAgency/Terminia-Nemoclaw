#!/usr/bin/env node
import { supabase } from '../../_shared/supabase-client.js';
import { callInference, parseInferenceJSON, isoNow } from '../../_shared/utils.js';

const MAX_TEXT_LENGTH = 12000;

const SYSTEM_PROMPT = `Sei un assistente legale specializzato nell'analisi contrattuale italiana. Estrai tutti i dati strutturati dal seguente contratto.

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
  ],
  "scope_items": [
    {
      "description": "Elemento dello scope",
      "included": true/false
    }
  ],
  "counterpart_identifiers": {
    "name": "Ragione sociale",
    "vat": "P.IVA (solo numeri)",
    "cf": "Codice Fiscale",
    "address": "Indirizzo sede legale",
    "legal_representative": "Nome del rappresentante legale"
  }
}`;

/**
 * Persist extracted clauses to the clauses table.
 */
async function insertClauses(contractId, companyId, clauses) {
  if (!clauses?.length) return;

  const now = isoNow();
  const rows = clauses.map((c) => ({
    contract_id: contractId,
    company_id: companyId,
    clause_type: c.clause_type || 'altro',
    title: c.title || null,
    summary: c.summary_it || null,
    risk_level: c.risk_level || 'low',
    risk_reason: c.risk_reason || null,
    original_text: c.original_text?.slice(0, 200) || null,
    created_at: now,
  }));

  const { error } = await supabase.from('clauses').insert(rows);
  if (error) throw new Error(`Failed to insert clauses: ${error.message}`);
}

/**
 * Persist extracted obligations to the obligations table.
 */
async function insertObligations(contractId, companyId, obligations) {
  if (!obligations?.length) return;

  const now = isoNow();
  const rows = obligations.map((o) => ({
    contract_id: contractId,
    company_id: companyId,
    description: o.description || null,
    responsible_party: o.responsible_party || null,
    deadline: o.deadline || null,
    recurring: o.recurring ?? false,
    frequency: o.frequency || null,
    created_at: now,
  }));

  const { error } = await supabase.from('obligations').insert(rows);
  if (error) throw new Error(`Failed to insert obligations: ${error.message}`);
}

/**
 * Persist extracted milestones to the milestones table.
 */
async function insertMilestones(contractId, companyId, milestones) {
  if (!milestones?.length) return;

  const now = isoNow();
  const rows = milestones.map((m) => ({
    contract_id: contractId,
    company_id: companyId,
    title: m.title || null,
    due_date: m.due_date || null,
    amount: m.amount ?? null,
    description: m.description || null,
    created_at: now,
  }));

  const { error } = await supabase.from('milestones').insert(rows);
  if (error) throw new Error(`Failed to insert milestones: ${error.message}`);
}

/**
 * Persist extracted scope items to the scope_items table.
 */
async function insertScopeItems(contractId, companyId, scopeItems) {
  if (!scopeItems?.length) return;

  const now = isoNow();
  const rows = scopeItems.map((s) => ({
    contract_id: contractId,
    company_id: companyId,
    description: s.description || null,
    included: s.included ?? true,
    created_at: now,
  }));

  const { error } = await supabase.from('scope_items').insert(rows);
  if (error) throw new Error(`Failed to insert scope_items: ${error.message}`);
}

/**
 * Update the contracts row with extracted dates, value, and renewal info.
 */
async function updateContract(contractId, extraction) {
  const { dates, value, renewal } = extraction;

  const updates = {
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
  };

  const { error } = await supabase
    .from('contracts')
    .update(updates)
    .eq('id', contractId);

  if (error) throw new Error(`Failed to update contract: ${error.message}`);
}

/**
 * Extract structured data from a classified Italian contract via AI inference.
 *
 * @param {{ text: string, contract_id: string, company_id: string }} input
 * @returns {Promise<object>} Extraction result
 */
async function handler(input) {
  const { text, contract_id, company_id } = input;

  if (!text) throw new Error('Missing required field: text');
  if (!contract_id) throw new Error('Missing required field: contract_id');
  if (!company_id) throw new Error('Missing required field: company_id');

  const userMessage = text.length > MAX_TEXT_LENGTH
    ? text.slice(0, MAX_TEXT_LENGTH)
    : text;

  let extraction;
  try {
    const raw = await callInference(SYSTEM_PROMPT, userMessage, {
      maxTokens: 4096,
    });
    extraction = parseInferenceJSON(raw);
  } catch (err) {
    return {
      dates: null,
      value: null,
      renewal: null,
      clauses: [],
      obligations: [],
      milestones: [],
      scope_items: [],
      counterpart_identifiers: null,
      error: `Inference failed: ${err.message}`,
    };
  }

  // --- Persist to Supabase (all scoped to company_id) ---
  const writeErrors = [];

  try {
    await updateContract(contract_id, extraction);
  } catch (err) {
    writeErrors.push(err.message);
  }

  try {
    await insertClauses(contract_id, company_id, extraction.clauses);
  } catch (err) {
    writeErrors.push(err.message);
  }

  try {
    await insertObligations(contract_id, company_id, extraction.obligations);
  } catch (err) {
    writeErrors.push(err.message);
  }

  try {
    await insertMilestones(contract_id, company_id, extraction.milestones);
  } catch (err) {
    writeErrors.push(err.message);
  }

  try {
    await insertScopeItems(contract_id, company_id, extraction.scope_items);
  } catch (err) {
    writeErrors.push(err.message);
  }

  const result = {
    dates: extraction.dates || null,
    value: extraction.value || null,
    renewal: extraction.renewal || null,
    clauses: extraction.clauses || [],
    obligations: extraction.obligations || [],
    milestones: extraction.milestones || [],
    scope_items: extraction.scope_items || [],
    counterpart_identifiers: extraction.counterpart_identifiers || null,
  };

  if (writeErrors.length) {
    result.write_errors = writeErrors;
  }

  return result;
}

// CLI entry point
async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input = JSON.parse(raw);
    const result = await handler(input);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
