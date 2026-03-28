---
name: bandi-sync-ted
description: Syncs EU procurement notices from TED Europa API filtered for Italy, runs daily via cron
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Syncs EU public procurement notices from TED Europa API (api.ted.europa.eu), filtered for Italian tenders above EU thresholds. Deduplicates by TED notice ID. Designed to run daily via cron.

## Input

```json
{
  "days_back": "number (optional) — how many days back to fetch; default 1 (last 24h)"
}
```

## Output

```json
{
  "synced": "number — newly inserted notices",
  "skipped_duplicates": "number — notices already present in bandi table",
  "errors": "number — notices that failed to parse or insert",
  "source": "string — always 'ted'"
}
```
