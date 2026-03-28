---
name: contract-classify
description: Classifies Italian contract PDFs by type, identifies parties, extracts metadata via nemotron-orchestrator inference
user-invocable: false
metadata: {"requires": {"env": ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]}}
---

## Description

Classifies uploaded contract PDFs by type, identifies parties, and extracts initial metadata.
Uses nemotron-orchestrator inference. Italian-first with structured JSON output.

## Input

```json
{
  "text": "string — extracted text from the contract PDF",
  "contract_id": "string (optional) — UUID of the contract row to update",
  "company_id": "string — UUID of the owning company"
}
```

## Output

```json
{
  "contract_type": "appalto_servizi | appalto_lavori | fornitura | consulenza | licenza_software | locazione | lavoro_subordinato | lavoro_determinato | somministrazione | collaborazione | nda | framework | altro",
  "counterpart_type": "fornitore | cliente | partner | dipendente | locatore | ente_pubblico",
  "language": "it | en | ...",
  "confidence": 0.0,
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
}
```
