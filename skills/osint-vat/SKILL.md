---
name: osint-vat
description: Validates EU VAT numbers via VIES REST API, caches results 30 days in Supabase
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VIES_API_KEY"]}}
---

## Description

Validates EU VAT numbers via the VIES (VAT Information Exchange System) REST API.
Checks if VAT is active and retrieves company name/address.
Results cached 30 days in Supabase.

## Input

```json
{
  "vat_number": "string — full VAT number, optionally prefixed with country code (e.g. 'IT01234567890' or '01234567890')",
  "country_code": "string (optional) — ISO 3166-1 alpha-2 country code, auto-detected from prefix if omitted",
  "counterpart_id": "string (optional) — UUID of a counterparts row to update with verification results"
}
```

## Output

```json
{
  "valid": "boolean | null — true if active, false if invalid, null on API error",
  "country_code": "string — two-letter country code used for the query",
  "vat_number": "string — numeric VAT portion (no country prefix)",
  "name": "string | null — registered company name from VIES",
  "address": "string | null — registered address from VIES",
  "request_date": "string — ISO date of the VIES response",
  "cached": "boolean — true if result came from cache",
  "error": "string | null — error description when valid is null"
}
```
