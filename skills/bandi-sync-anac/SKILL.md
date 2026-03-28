---
name: bandi-sync-anac
description: Syncs Italian public procurement tenders from ANAC OpenData, runs daily via cron
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Syncs Italian public procurement tenders from ANAC OpenData (dati.anticorruzione.it).
Downloads latest CSV/JSON datasets, parses structured fields, deduplicates by CIG.
Designed to run daily via cron.

## Input

```json
{
  "company_id": "string (optional) — UUID of a company row; if omitted, syncs for all active companies"
}
```

## Output

```json
{
  "synced": "number — new bandi inserted",
  "skipped_duplicates": "number — bandi already present (matched by CIG)",
  "errors": "number — individual records that failed to parse",
  "source": "string — always 'anac'"
}
```
