---
name: osint-anac-casellario
description: Checks ANAC Casellario Informatico for supplier annotations via web scraping, caches 7 days
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Checks ANAC Casellario Informatico for supplier annotations via web scraping.
Looks for exclusions from public procurement, false declarations, and other
negative records. Results cached 7 days. Fragile by nature (scraping) — degrades
gracefully.

## Input

```json
{
  "vat_number": "string — P.IVA of the supplier to check (required)",
  "company_name": "string — company name, used as fallback search (required)",
  "counterpart_id": "string (optional) — UUID of a counterparts row to update with results"
}
```

## Output

```json
{
  "checked": "boolean — true if ANAC was successfully queried",
  "annotations_found": "boolean — true if negative annotations exist",
  "annotations": [
    {
      "type": "esclusione | annotazione | falsa_dichiarazione | altro",
      "date": "string | null — YYYY-MM-DD if parseable",
      "description": "string — annotation text",
      "reference": "string — procedura/provvedimento reference"
    }
  ],
  "source_url": "string — URL used for the search",
  "checked_at": "string — ISO 8601 timestamp",
  "error": "string | null — error code when checked is false (anac_unavailable, anac_timeout, page_structure_changed)"
}
```
