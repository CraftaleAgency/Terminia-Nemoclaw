---
name: osint-cf
description: Validates Italian Codice Fiscale using official algorithm, pure local computation, GDPR compliant
user-invocable: false
---

## Description

Validates Italian Codice Fiscale using the official algorithm.
Checks checksum, extracts and matches surname/name/DOB/municipality.
GDPR compliant — pure local computation, no external API.

## Input

```json
{
  "codice_fiscale": "string — 16-character Italian fiscal code (required)",
  "nome": "string — first name for matching (optional)",
  "cognome": "string — surname for matching (optional)",
  "data_nascita": "string — date of birth YYYY-MM-DD for matching (optional)",
  "counterpart_id": "uuid — counterpart to update in Supabase (optional)",
  "employee_id": "uuid — employee to update in Supabase (optional)"
}
```

## Output

```json
{
  "valid": "boolean — overall validity (format + checksum)",
  "checksum_ok": "boolean — check character matches",
  "extracted": {
    "surname_code": "string — 3-char surname code from CF",
    "name_code": "string — 3-char name code from CF",
    "birth_year": "string — 2-digit birth year",
    "birth_month": "number — month 1-12",
    "birth_day": "number — day of birth (adjusted for gender)",
    "gender": "string — M or F",
    "municipality_code": "string — 4-char municipality (catastale) code"
  },
  "matches": {
    "surname": "boolean | null — surname match (null if not provided)",
    "name": "boolean | null — name match (null if not provided)",
    "birth_date": "boolean | null — birth date match (null if not provided)"
  },
  "errors": "string[] — list of validation errors"
}
```
