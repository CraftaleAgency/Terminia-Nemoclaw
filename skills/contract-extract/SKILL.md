---
name: contract-extract
description: Deep extraction of structured data from classified contracts — dates, clauses, obligations, milestones, scope items
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Deep extraction of structured data from classified contracts.
Extracts dates, values, clauses, obligations, milestones, scope items, and renewal terms.
Writes to multiple Supabase tables. Triggers OSINT verification chain for extracted counterpart.

Runs **after** `contract-classify` has identified the contract type and parties.
Uses nemotron-orchestrator inference. Italian-first with structured JSON output.

## Input

```json
{
  "text": "string — extracted text from the contract PDF",
  "contract_id": "string — UUID of the contract row to update",
  "company_id": "string — UUID of the owning company"
}
```

## Output

```json
{
  "dates": {
    "start_date": "YYYY-MM-DD or null",
    "end_date": "YYYY-MM-DD or null",
    "signing_date": "YYYY-MM-DD or null",
    "notice_period_days": "number or null"
  },
  "value": {
    "total_value": "number or null",
    "currency": "EUR",
    "payment_terms_days": "number or null",
    "payment_method": "string or null"
  },
  "renewal": {
    "auto_renewal": "boolean",
    "renewal_notice_days": "number or null",
    "max_renewals": "number or null",
    "renewal_duration_months": "number or null"
  },
  "clauses": [
    {
      "clause_type": "penale|riservatezza|non_compete|limitazione_responsabilita|proprieta_intellettuale|recesso|foro_competente|forza_maggiore|garanzia|altro",
      "title": "string",
      "summary_it": "string",
      "risk_level": "low|medium|high|critical",
      "risk_reason": "string or null",
      "original_text": "string (max 200 chars)"
    }
  ],
  "obligations": [
    {
      "description": "string",
      "responsible_party": "company|counterpart",
      "deadline": "YYYY-MM-DD or null",
      "recurring": "boolean",
      "frequency": "monthly|quarterly|yearly|once or null"
    }
  ],
  "milestones": [
    {
      "title": "string",
      "due_date": "YYYY-MM-DD or null",
      "amount": "number or null",
      "description": "string"
    }
  ],
  "scope_items": [
    {
      "description": "string",
      "included": "boolean"
    }
  ],
  "counterpart_identifiers": {
    "name": "string — ragione sociale",
    "vat": "string — P.IVA (solo numeri)",
    "cf": "string — Codice Fiscale",
    "address": "string — indirizzo sede legale",
    "legal_representative": "string — nome del rappresentante legale"
  }
}
```

## Supabase tables written

| Table | Action | Key fields |
|-------|--------|------------|
| `contracts` | UPDATE | dates, value, renewal flags, payment terms, `status → 'extracted'` |
| `clauses` | INSERT | contract_id, company_id, clause_type, title, summary, risk_level, risk_reason, original_text |
| `obligations` | INSERT | contract_id, company_id, description, responsible_party, deadline, recurring, frequency |
| `milestones` | INSERT | contract_id, company_id, title, due_date, amount, description |
| `scope_items` | INSERT | contract_id, company_id, description, included |

## Pipeline position

`contract-classify` → **contract-extract** → OSINT verification chain
