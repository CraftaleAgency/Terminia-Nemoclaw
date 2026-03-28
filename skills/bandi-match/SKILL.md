---
name: bandi-match
description: Matches tenders against company profiles using 5-dimension scoring, creates alerts for high matches
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Matches public procurement tenders against company profiles using 5-dimension scoring
(sector, size, geography, requirements, feasibility). Uses AI inference for nuanced
CPV↔ATECO mapping and requirement analysis. Creates alerts for high-match tenders (>80%).
Designed to run after bandi-sync skills.

## Input

```json
{
  "company_id": "string (optional) — UUID of a company row; if omitted, runs for all active companies"
}
```

## Output

```json
{
  "matched": "number — bandi scored in this run",
  "alerts_created": "number — high-match alerts inserted",
  "errors": "number — individual (company, bando) pairs that failed to score"
}
```
