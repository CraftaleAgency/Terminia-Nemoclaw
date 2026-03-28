---
name: contract-risk-score
description: Computes risk score (0-100) for contracts using rules engine and AI inference, creates alerts for high-risk items
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Computes risk score (0–100) for a contract using a rules engine + AI inference for nuanced clause analysis.
Creates alerts for high-risk items, expiring contracts, and upcoming milestones.

Runs **after** `contract-extract` has populated clauses, obligations, and milestones in Supabase.
Uses nemotron-orchestrator inference for Italian-language clause assessment.

## Input

```json
{
  "contract_id": "string — UUID of the contract to score",
  "company_id": "string — UUID of the owning company"
}
```

## Output

```json
{
  "risk_score": "number 0-100",
  "risk_label": "low|medium|high|critical",
  "risk_details": {
    "rule_scores": {
      "renewal_risk": "number",
      "payment_risk": "number",
      "duration_risk": "number",
      "clause_risk": "number",
      "specific_clause_risk": "number",
      "obligation_risk": "number"
    },
    "clause_assessments": [
      {
        "clause_type": "string",
        "risk_summary_it": "string",
        "recommendation_it": "string"
      }
    ],
    "total": "number"
  },
  "alerts_created": "number"
}
```

## Scoring rules (higher = MORE risky)

| Category | Condition | Points |
|----------|-----------|--------|
| Renewal | auto_renewal + no renewal_notice_days | +15 |
| Renewal | auto_renewal + renewal_notice_days < 30 | +10 |
| Renewal | auto_renewal with adequate notice | +5 |
| Payment | payment_terms_days > 60 | +10 |
| Payment | payment_terms_days > 30 | +5 |
| Duration | no end_date (indefinite) | +5 |
| Clauses | any clause risk_level = "critical" | +20 |
| Clauses | each clause risk_level = "high" (max +30) | +10 |
| Clauses | each clause risk_level = "medium" (max +15) | +5 |
| Specific | non_compete ≥ medium | +15 |
| Specific | limitazione_responsabilita ≥ high | +10 |
| Specific | proprieta_intellettuale ≥ medium | +10 |
| Specific | penale ≥ high | +10 |
| Specific | foro_competente present | +5 |
| Obligations | deadline in the past | +5 each |
| Obligations | deadline within 7 days | +3 each |

## Supabase tables read

| Table | Fields used |
|-------|-------------|
| `contracts` | dates, value, renewal info, payment_terms_days |
| `clauses` | clause_type, risk_level |
| `obligations` | deadline |
| `milestones` | due_date |

## Supabase tables written

| Table | Action | Key fields |
|-------|--------|------------|
| `contracts` | UPDATE | risk_score, risk_label, risk_details, `status → 'analyzed'` |
| `alerts` | INSERT | company_id, type, title, message, priority, related_entity_type, related_entity_id |

## Pipeline position

`contract-classify` → `contract-extract` → **contract-risk-score** → alerts / dashboard
