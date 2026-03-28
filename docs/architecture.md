# Terminia-Nemoclaw — Architecture

> AI inference and sandboxed agent platform for the Terminia ecosystem.
> Target audience: developers joining the project.

---

## Table of Contents

1. [Overview](#1-overview)
2. [System Architecture](#2-system-architecture)
3. [Inference Stack (Nebula)](#3-inference-stack-nebula)
4. [Agent Platform (NemoClaw)](#4-agent-platform-nemoclaw)
5. [OpenClaw Skills](#5-openclaw-skills)
6. [Data Flow](#6-data-flow)
7. [Shared Infrastructure](#7-shared-infrastructure)
8. [Security](#8-security)
9. [Deployment](#9-deployment)
10. [External Integrations](#10-external-integrations)

---

## 1. Overview

Terminia is an AI-powered platform for Italian SMEs built around four pillars:

| Pillar | Purpose |
|--------|---------|
| **Contract Intelligence** | Upload a PDF → automatic classification, clause extraction, risk scoring, deadline tracking |
| **Counterpart OSINT** | Verify suppliers/partners via VAT (VIES), Codice Fiscale, ANAC Casellario — produce a 0–100 reliability score |
| **HR Intelligence** | Employee contract analysis, obligation tracking, regulatory compliance *(future)* |
| **BandoRadar** | Daily sync of Italian (ANAC) and EU (TED) public procurement tenders, AI-scored against company profiles |

### This repository's role

**Terminia-Nemoclaw** is the AI backend. It provides:

- **Inference** — four llama.cpp model servers behind a LiteLLM proxy (Nebula stack)
- **Agent execution** — NVIDIA NemoClaw/OpenShell sandboxed environment running OpenClaw skills
- **Skills** — 10 JavaScript agent skills that read/write Supabase

The frontend (Terminia-Frontend, separate Next.js repo) reads from Supabase.
The agents write to Supabase using a service role key — the two halves never talk directly.

---

## 2. System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         TERMINIA PLATFORM                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌───────────────┐        ┌──────────────────────────────────────┐  │
│  │   Frontend     │        │         Supabase (DB + Auth)         │  │
│  │   (Next.js)    │───────▶│   PostgreSQL · Storage · RLS         │  │
│  │   separate repo│◀───────│   Row Level Security for tenants     │  │
│  └───────────────┘        └────────────────┬─────────────────────┘  │
│                                             │                        │
│                              service role key (env var)              │
│                                             │                        │
│  ┌──────────────────────────────────────────▼─────────────────────┐  │
│  │               TERMINIA-NEMOCLAW  (this repo)                   │  │
│  │                                                                │  │
│  │  ┌──────────────────────────────────────────────────────────┐  │  │
│  │  │               OpenClaw Sandbox (terminia)                │  │  │
│  │  │                                                          │  │  │
│  │  │  ┌───────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │  │  │
│  │  │  │ Contract  │ │  OSINT   │ │  Bando   │ │   Doc    │  │  │  │
│  │  │  │ Pipeline  │ │  Skills  │ │  Radar   │ │ Preproc  │  │  │  │
│  │  │  │ (3 skills)│ │(3 skills)│ │(3 skills)│ │(1 skill) │  │  │  │
│  │  │  └─────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘  │  │  │
│  │  │        └─────────────┴────────────┴────────────┘        │  │  │
│  │  │                          │                               │  │  │
│  │  │               https://inference.local                    │  │  │
│  │  └──────────────────────────┼───────────────────────────────┘  │  │
│  │                             │ (intercepted)                    │  │
│  │  ┌──────────────────────────▼───────────────────────────────┐  │  │
│  │  │          OpenShell Gateway  (:18789 → :30051)            │  │  │
│  │  │    Sandbox lifecycle · Inference routing · Policy         │  │  │
│  │  └──────────────────────────┬───────────────────────────────┘  │  │
│  │                             │                                  │  │
│  │  ┌──────────────────────────▼───────────────────────────────┐  │  │
│  │  │            LiteLLM Proxy  (:4000)                        │  │  │
│  │  │      OpenAI-compatible routing gateway                    │  │  │
│  │  └───┬──────────┬──────────┬──────────┬─────────────────────┘  │  │
│  │      │          │          │          │                        │  │
│  │  ┌───▼────┐ ┌───▼────┐ ┌───▼────┐ ┌───▼────┐                 │  │
│  │  │  Orch  │ │ Worker │ │ Vision │ │  OCR   │                 │  │
│  │  │ :8083  │ │ :8084  │ │ :8085  │ │ :8086  │                 │  │
│  │  │  8B    │ │  4B    │ │  12B   │ │  8B    │                 │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘                 │  │
│  │  Nemotron   Nemotron   Nemotron   NuMarkdown                  │  │
│  │  Orchestr.  Nano-3     Nano-VL    8B-Think                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Inference Stack (Nebula)

All inference runs on **llama.cpp** (`local/llama-server:latest`) behind a **LiteLLM** proxy.
Defined in `nebula/docker-compose.yml`.

### 3.1 Model Servers

| Service | Container | Host Port | Model | Params | Quant | Purpose |
|---------|-----------|-----------|-------|--------|-------|---------|
| Orchestrator | `llama-server-orchestrator` | 8083 | Nemotron-Orchestrator-8B (Claude 4.5 Opus Distill) | 8B | Q4_K_M (~5 GB) | Task planning, complex reasoning, contract analysis |
| Worker | `llama-server-worker` | 8084 | NVIDIA-Nemotron3-Nano-4B | 4B | Q4_K_M (~2.5 GB) | Fast execution, simple tasks |
| Vision | `llama-server-vision` | 8085 | NVIDIA-Nemotron-Nano-12B-v2-VL | 12B | Q4_K_M | Image + text understanding |
| OCR | `llama-server-ocr` | 8086 | NuMarkdown-8B-Thinking | 8B | Q4_K_M + mmproj Q8_0 | Document OCR, scanned PDF extraction |

Each server listens on `:8080` internally and maps to a unique host port.

> **Known issue:** Nemotron-3-Nano-4B uses the `nemotron_h` (hybrid Mamba-Transformer)
> architecture, which requires the **official** llama.cpp build — the `ik_llama.cpp` fork
> does not support it. Rebuild with:
> ```bash
> git clone --depth 1 https://github.com/ggml-org/llama.cpp
> cd llama.cpp && docker build -t local/llama-server:latest .
> ```

### 3.2 LiteLLM Proxy — Routing Table

Defined in `nebula/litellm-config.yaml`. The proxy exposes a single OpenAI-compatible
endpoint on `:4000` and routes by model alias:

| Alias | Backend | Container | Vision |
|-------|---------|-----------|--------|
| `default` | `openai/nemotron-orchestrator-8b` | `llama-server-orchestrator:8080` | No |
| `nemotron-orchestrator` | `openai/nemotron-orchestrator-8b` | `llama-server-orchestrator:8080` | No |
| `nemotron-nano` / `fast` | `openai/nemotron-nano-4b` | `llama-server-worker:8080` | No |
| `numarkdown` / `ocr` | `openai/numarkdown` | `llama-server-ocr:8080` | Yes |

Key settings:

```yaml
litellm_settings:
  drop_params: true    # silently drop unsupported params (e.g. tool_choice)
  set_verbose: false
```

All backend `api_key` values are `dummy` — llama.cpp doesn't authenticate.

### 3.3 Docker Networking

```
┌─────────────────────────────────────────────────────────────┐
│         llmserver-ai-network  (172.28.0.0/16)               │
│                                                             │
│  llama-server-orchestrator:8080                             │
│  llama-server-worker:8080                                   │
│  llama-server-ocr:8080                                      │
│  litellm-proxy:4000                                         │
│  openshell-gateway:30051                                    │
└─────────────────────┬───────────────────────────────────────┘
                      │ (dual-homed containers)
┌─────────────────────▼───────────────────────────────────────┐
│         dokploy-network  (10.0.1.0/24)                      │
│  Traefik reverse proxy → Cloudflare Tunnel                  │
└─────────────────────────────────────────────────────────────┘
```

Both networks are `external: true` — created once with `nebula/create-network.sh`:

```bash
docker network create --driver bridge \
  --subnet 172.28.0.0/16 \
  --opt com.docker.network.bridge.name=br-llmserver \
  llmserver-ai-network
```

### 3.4 External Access

| Domain | Routes to |
|--------|-----------|
| `ai.pezserv.org` | `litellm-proxy:4000` |
| `nemoclaw.pezserv.org` | `openshell-gateway:30051` (optional) |

Traffic path: **Internet → Cloudflare Tunnel → Traefik (dokploy-network) → service**.

---

## 4. Agent Platform (NemoClaw)

[NVIDIA NemoClaw](https://docs.nvidia.com/nemoclaw/latest/) manages
[OpenClaw](https://openclaw.ai) agents inside
[OpenShell](https://github.com/NVIDIA/OpenShell) sandboxes.

### 4.1 OpenShell Gateway

Defined in `nemoclaw/docker-compose.yml`. Single container:

```yaml
openshell-gateway:
  image: ghcr.io/nvidia/openshell/cluster:0.0.16
  privileged: true
  pid: host
  ports:
    - "18789:30051"
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock   # manages sandbox containers
    - nemoclaw-data:/root/.nemoclaw
    - openshell-data:/root/.openshell
    - sandbox-data:/sandbox
```

The gateway manages the full sandbox lifecycle — sandboxes are **not** compose services,
they are containers created by the gateway at runtime.

### 4.2 NemoClaw CLI

Installed on the **host** (not inside containers):

```bash
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
```

Key commands:

| Command | Purpose |
|---------|---------|
| `nemoclaw terminia connect` | Enter the sandbox shell |
| `nemoclaw terminia status` | Health + inference status |
| `nemoclaw terminia logs --follow` | Stream sandbox logs |
| `openshell sandbox connect terminia -- <cmd>` | Run a command inside sandbox |
| `openshell sandbox upload terminia <src> <dst>` | Upload files into sandbox |
| `openshell sandbox download terminia <src> <dst>` | Download files from sandbox |
| `openshell term` | TUI: monitor agents, approve network egress |
| `openshell provider create ...` | Register an inference provider |
| `openshell inference set --provider litellm --model nemotron-orchestrator` | Set active model |
| `openshell policy set <file>` | Apply a network/filesystem policy |

### 4.3 Sandbox Isolation

| Layer | Policy |
|-------|--------|
| **Network** | Deny-by-default. Only whitelisted endpoints allowed (see §8). Unlisted requests require operator approval via `openshell term` TUI. |
| **Filesystem** | `/sandbox` and `/tmp` are writable. `/usr`, `/lib`, `/app`, `/etc` are read-only. Everything else is denied. |
| **Credentials** | Stored in `~/.nemoclaw/credentials.json` **on the host**. Never mounted or visible inside the sandbox. |
| **Inference** | Sandbox calls `https://inference.local` — OpenShell intercepts and forwards to litellm-proxy with credentials injected. |

### 4.4 Inference Routing

```
Agent code                 OpenShell Gateway          LiteLLM Proxy         llama-server
    │                           │                          │                      │
    │  POST inference.local     │                          │                      │
    │  /v1/chat/completions     │                          │                      │
    │──────────────────────────▶│                          │                      │
    │                           │  POST litellm-proxy:4000 │                      │
    │                           │  /v1/chat/completions    │                      │
    │                           │  + injected api_key      │                      │
    │                           │─────────────────────────▶│                      │
    │                           │                          │  POST :8080/v1/...   │
    │                           │                          │─────────────────────▶│
    │                           │                          │◀─────────────────────│
    │                           │◀─────────────────────────│                      │
    │◀──────────────────────────│                          │                      │
```

Skills use the `callInference()` helper from `_shared/utils.js`:

```js
const response = await fetch('https://inference.local/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'nemotron-orchestrator',  // resolved by LiteLLM
    messages: [...],
    temperature: 0.2,
    max_tokens: 4096,
  }),
});
```

### 4.5 Policy File

Located at `nemoclaw/policies/openclaw-sandbox.yaml`. Defines filesystem and network rules.
See §8 (Security) for the full network whitelist.

---

## 5. OpenClaw Skills

All skills live in `skills/`. Each has a `SKILL.md` manifest and a `scripts/handler.js` entry point.

### 5.0 Skill Inventory

| # | Skill | Category | Invocable | Trigger | Input | Output | External API |
|---|-------|----------|-----------|---------|-------|--------|--------------|
| 1 | `document-preprocessor` | Utility | No | Contract upload event | Storage path + MIME type | Clean text + method + confidence | — (OCR via inference) |
| 2 | `contract-classify` | Contract | No | After preprocessing | Extracted text | Contract type, parties, language | — (inference only) |
| 3 | `contract-extract` | Contract | No | After classification | Text + contract_id | Dates, values, clauses, obligations, milestones | — (inference only) |
| 4 | `contract-risk-score` | Contract | No | After extraction | contract_id | Risk score 0–100, alerts | — (inference only) |
| 5 | `osint-cf` | OSINT | No | Counterpart extracted | Codice Fiscale string | Validity, checksum, extracted fields | — (local algorithm) |
| 6 | `osint-vat` | OSINT | No | Counterpart extracted | VAT number | VIES validation result | VIES REST API |
| 7 | `osint-anac-casellario` | OSINT | No | Counterpart extracted | VAT + company name | Annotations, exclusions | ANAC Casellario (scraping) |
| 8 | `bandi-sync-anac` | BandoRadar | No | Cron 06:00 daily | — | Synced/skipped counts | ANAC OpenData |
| 9 | `bandi-sync-ted` | BandoRadar | No | Cron 06:30 daily | days_back (default 1) | Synced/skipped counts | TED Europa API |
| 10 | `bandi-match` | BandoRadar | No | Cron 07:00 daily | company_id (optional) | Matches scored, alerts created | — (inference only) |

All skills require `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` except `osint-cf` (pure local computation).

### 5.1 Contract Pipeline

```
  ┌─────────────────────┐
  │  Document Upload     │
  │  (Supabase Storage)  │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │ document-preprocessor│    PDF/DOCX/Image → clean text
  │ model: ocr (8086)   │    Routes scanned docs through NuMarkdown
  └──────────┬──────────┘
             │ text
             ▼
  ┌─────────────────────┐
  │  contract-classify   │    Type, parties, language, confidence
  │ model: orchestrator  │    13 contract types recognized
  └──────────┬──────────┘
             │ contract_type + parties
             ▼
  ┌─────────────────────┐
  │  contract-extract    │    Dates, values, clauses, obligations,
  │ model: orchestrator  │    milestones, scope items, renewal terms
  └──────────┬──────────┘    Writes to 5 Supabase tables
             │
      ┌──────┴──────┐
      │             │
      ▼             ▼
  ┌──────────┐  ┌──────────────┐
  │ contract │  │ OSINT chain  │    Triggered for extracted
  │ risk-    │  │ (§5.2)       │    counterpart identifiers
  │ score    │  └──────────────┘
  │ model:   │
  │ orchestr.│
  └──────┬───┘
         │ risk_score, alerts
         ▼
  ┌─────────────────────┐
  │  Dashboard / Alerts  │
  │  (Terminia-Frontend) │
  └─────────────────────┘
```

**Contract types recognized:** appalto_servizi, appalto_lavori, fornitura, consulenza,
licenza_software, locazione, lavoro_subordinato, lavoro_determinato, somministrazione,
collaborazione, nda, framework, altro.

**Risk scoring rules** (higher = riskier):

| Category | Condition | Points |
|----------|-----------|--------|
| Renewal | Auto-renewal + no notice period | +15 |
| Renewal | Auto-renewal + notice < 30 days | +10 |
| Payment | payment_terms_days > 60 | +10 |
| Duration | No end_date (indefinite) | +5 |
| Clauses | Any critical-risk clause | +20 |
| Clauses | Each high-risk clause (max +30) | +10 |
| Specific | non_compete ≥ medium | +15 |
| Specific | limitazione_responsabilita ≥ high | +10 |
| Obligations | Past-due deadline | +5 each |

### 5.2 OSINT Skills

Three skills verify counterpart identity and produce a composite **Reliability Score**.

#### osint-cf — Codice Fiscale Validation

- **Method:** Local algorithm (no API call)
- **Validates:** Checksum, format, optionally matches name/DOB
- **GDPR:** Fully compliant — pure computation, no external data
- **Cache:** None needed

#### osint-vat — EU VAT Validation

- **Method:** VIES REST API (`ec.europa.eu`)
- **Returns:** Active/invalid status, registered company name and address
- **Cache:** 30 days in Supabase (via `_shared/cache.js`)
- **Requires:** `VIES_API_KEY` environment variable

#### osint-anac-casellario — Supplier Annotations

- **Method:** Web scraping of `casellario.anticorruzione.it`
- **Checks:** Exclusions from public procurement, false declarations, negative records
- **Cache:** 7 days in Supabase
- **Fragile:** Scraping-based — degrades gracefully on page structure changes

#### Reliability Score Composition

Computed by `computeReliabilityScore()` in `_shared/utils.js`:

| Dimension | Max Weight | Source |
|-----------|-----------|--------|
| Legal | 30 | ANAC Casellario (annotations, exclusions) |
| Contributory | 20 | VIES (VAT active, address verified) |
| Reputation | 20 | ANAC history + inference analysis |
| Solidity | 20 | Financial indicators (when available) |
| Consistency | 10 | CF validation, data cross-checks |
| **Total** | **100** | |

```js
function computeReliabilityScore({ legal, contributory, reputation, solidity, consistency }) {
  return clamp(legal, 0, 30) + clamp(contributory, 0, 20) + clamp(reputation, 0, 20)
       + clamp(solidity, 0, 20) + clamp(consistency, 0, 10);
}
```

Labels: `≥80` excellent · `≥60` good · `≥40` warning · `<40` risk.

### 5.3 BandoRadar

Daily pipeline that syncs public procurement tenders and scores them against company profiles.

#### Cron Schedule

| Time (UTC) | Skill | Source |
|------------|-------|--------|
| 06:00 | `bandi-sync-anac` | ANAC OpenData (`dati.anticorruzione.it`) |
| 06:30 | `bandi-sync-ted` | TED Europa API (`api.ted.europa.eu`) |
| 07:00 | `bandi-match` | Local inference — scores all new bandi |

#### Data Flow

```
  06:00                     06:30                     07:00
    │                         │                         │
    ▼                         ▼                         ▼
┌──────────┐          ┌──────────┐          ┌──────────────────┐
│bandi-sync│          │bandi-sync│          │   bandi-match    │
│  -anac   │          │  -ted    │          │                  │
│          │          │          │          │ For each company: │
│ Download │          │ Query    │          │  - Load profile  │
│ CSV/JSON │          │ API for  │          │  - Score each    │
│ datasets │          │ Italian  │          │    new bando     │
│          │          │ notices  │          │  - 5-dimension   │
│ Dedup by │          │          │          │    scoring via   │
│ CIG code │          │ Dedup by │          │    inference     │
│          │          │ TED ID   │          │  - Alert if >80% │
└────┬─────┘          └────┬─────┘          └────────┬─────────┘
     │                     │                         │
     └─────────┬───────────┘                         │
               ▼                                     ▼
     ┌──────────────────┐              ┌──────────────────────┐
     │  Supabase: bandi  │              │  Supabase: alerts    │
     │  table (upsert)   │              │  (high-match bandi)  │
     └──────────────────┘              └──────────────────────┘
```

#### Match Score Composition

Computed by `computeMatchScore()` in `_shared/utils.js`:

| Dimension | Max Weight | What it measures |
|-----------|-----------|------------------|
| Sector | 35 | CPV↔ATECO code mapping via inference |
| Size | 25 | Contract value vs. company revenue range |
| Geo | 20 | Geographic proximity (province/region match) |
| Requirements | 15 | Technical requirements vs. company capabilities |
| Feasibility | 5 | Timeline, resource, and administrative feasibility |
| **Total** | **100** | |

---

## 5.4 Workspace Files

Agent personality and behavior files live in `workspace/` and are uploaded to
`/sandbox/.openclaw/workspace/` during `setup.sh`.

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality, tone, behavioral rules, available skills |
| `IDENTITY.md` | Agent name (Terminia), emoji, tagline, self-introduction |
| `USER.md` | Default company profile template (populated per-user) |
| `AGENTS.md` | Skill orchestration flows, safety guidelines, memory conventions |

Backup and restore: `./scripts/backup-workspace.sh backup terminia` / `restore`.

---

## 6. Data Flow

### 6.1 Contract Upload → Analysis

```
User uploads PDF via Frontend
    │
    ▼
Supabase Storage (contracts/{company_id}/{file}.pdf)
    │
    │  Trigger / webhook
    ▼
document-preprocessor
    │  Downloads from storage, extracts text
    │  If scanned → OCR via NuMarkdown (model: "ocr")
    │  Writes: { text, method, pages, confidence }
    ▼
contract-classify
    │  Infers contract type + parties via orchestrator
    │  Writes: contracts.contract_type, contracts.parties, contracts.status='classified'
    ▼
contract-extract
    │  Deep extraction: dates, values, clauses, obligations, milestones
    │  Writes: contracts (UPDATE) + clauses, obligations, milestones, scope_items (INSERT)
    │  Writes: contracts.status='extracted'
    │
    ├─▶ contract-risk-score
    │       Rules engine + AI clause assessment
    │       Writes: contracts.risk_score, contracts.risk_label, contracts.status='analyzed'
    │       Creates: alerts (high-risk items, expiring contracts, upcoming milestones)
    │
    └─▶ OSINT verification chain (if counterpart has VAT/CF)
            osint-cf  → validates Codice Fiscale (local)
            osint-vat → validates VAT via VIES (cached 30d)
            osint-anac-casellario → checks annotations (cached 7d)
            Writes: counterparts table (reliability_score, verification results)
```

### 6.2 BandoRadar Daily Sync

```
Cron (inside sandbox)
    │
    ├── 06:00  bandi-sync-anac
    │          GET dati.anticorruzione.it → parse CSV/JSON → upsert bandi (dedup by CIG)
    │
    ├── 06:30  bandi-sync-ted
    │          GET api.ted.europa.eu → parse notices → upsert bandi (dedup by TED ID)
    │
    └── 07:00  bandi-match
               For each active company:
                 Load company profile (ATECO codes, region, revenue, capabilities)
                 For each unscored bando:
                   Call inference → 5-dimension match scoring
                   If match_score > 80 → create alert
               Writes: bando_matches table + alerts table
```

### 6.3 OSINT Verification

Triggered automatically when `contract-extract` finds counterpart identifiers (VAT, CF):

```
contract-extract output: { counterpart_identifiers: { vat, cf, name } }
    │
    ├─▶ osint-cf(codice_fiscale=cf)
    │     └─▶ Supabase: counterparts.cf_valid, cf_details
    │
    ├─▶ osint-vat(vat_number=vat)
    │     ├─ Check cache (30d TTL)
    │     ├─ If miss → VIES API
    │     └─▶ Supabase: counterparts.vat_valid, vat_details
    │
    └─▶ osint-anac-casellario(vat_number=vat, company_name=name)
          ├─ Check cache (7d TTL)
          ├─ If miss → scrape casellario.anticorruzione.it
          └─▶ Supabase: counterparts.anac_annotations, anac_checked_at

    Then: compute reliability_score from all 3 results
          └─▶ Supabase: counterparts.reliability_score, reliability_label
```

---

## 7. Shared Infrastructure

### 7.1 `skills/_shared/` Modules

All skills import from three shared modules:

#### `supabase-client.js`

Creates a single Supabase client using service role credentials:

```js
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
```

Service role bypasses RLS — skills have full database access.

#### `cache.js`

Supabase-backed cache with configurable TTL:

| Function | Purpose |
|----------|---------|
| `getCached(table, keyColumn, keyValue, timestampColumn, maxAgeMinutes)` | Read if within TTL |
| `setCache(table, data, conflictColumn)` | Upsert with conflict resolution |

#### `utils.js`

| Function | Purpose |
|----------|---------|
| `callInference(systemPrompt, userMessage, options)` | POST to `inference.local` with model routing |
| `parseInferenceJSON(text)` | Strip markdown code fences, parse JSON |
| `computeReliabilityScore({...})` | 5-dimension reliability score (max 100) |
| `computeMatchScore({...})` | 5-dimension bando match score (max 100) |
| `reliabilityLabel(score)` | Score → `excellent\|good\|warning\|risk\|unknown` |
| `clamp(value, min, max)` | Numeric clamp |
| `isoNow()` | Current UTC ISO 8601 string |

### 7.2 Caching Strategy

| Data Source | Cache Location | TTL | Key Column |
|-------------|---------------|-----|------------|
| VIES VAT validation | Supabase `vat_cache` (or similar) | 30 days | `vat_number` |
| ANAC Casellario annotations | Supabase `anac_cache` (or similar) | 7 days | `vat_number` |
| ANAC OpenData tenders | Supabase `bandi` table (persistent) | ∞ (dedup by CIG) | `cig` |
| TED Europa notices | Supabase `bandi` table (persistent) | ∞ (dedup by TED ID) | `ted_notice_id` |

Cache reads check `updated_at` column age against max TTL. On miss, the external API is called and the result is upserted.

---

## 8. Security

### 8.1 Sandbox Network Policy

Defined in `nemoclaw/policies/openclaw-sandbox.yaml`. **Deny-by-default** — only explicitly
whitelisted endpoints are reachable.

| Rule Name | Endpoint(s) | Allowed Binaries | Methods |
|-----------|-------------|------------------|---------|
| `inference` | `inference.local:443` | `openclaw` | ALL |
| `github` | `github.com:443` | `gh`, `git` | ALL |
| `github_rest_api` | `api.github.com:443` | `gh` | GET, POST, PATCH, PUT, DELETE |
| `clawhub` | `clawhub.com:443` | `openclaw` | GET, POST |
| `openclaw_api` | `openclaw.ai:443` | `openclaw` | GET, POST |
| `openclaw_docs` | `docs.openclaw.ai:443` | `openclaw` | GET |
| `npm_registry` | `registry.npmjs.org:443` | `openclaw`, `npm` | GET |
| `supabase` | `*.supabase.co:443` | `node`, `openclaw` | ALL |
| `vies_api` | `ec.europa.eu:443` | `node` | GET, POST |
| `anac_opendata` | `dati.anticorruzione.it:443` | `node` | GET |
| `anac_casellario` | `casellario.anticorruzione.it:443` | `node` | GET, POST |
| `ted_europa` | `ted.europa.eu:443`, `api.ted.europa.eu:443` | `node` | GET |
| `claude_code` | `api.anthropic.com:443` | `claude_code` | ALL |
| `nvidia` | `*.nvidia.com:443` | `openclaw`, `node` | GET, POST |
| `telegram` | `api.telegram.org:443` | `node` | GET, POST |

Any request not matching these rules is **blocked** unless an operator approves it
in real-time via `openshell term`.

### 8.2 Filesystem Policy

```yaml
filesystem:
  read_write:
    - /sandbox
    - /tmp
    - /dev/null
  read_only:
    - /usr
    - /lib
    - /proc
    - /dev/urandom
    - /app
    - /etc
    - /var/log
```

### 8.3 Credential Isolation

| Secret | Location | Visible to sandbox? |
|--------|----------|---------------------|
| Inference API keys | `~/.nemoclaw/credentials.json` (host) | **No** — injected by OpenShell gateway |
| Supabase service role key | Sandbox env var (set via `openshell sandbox connect`) | Yes — required by skills |
| VIES API key | Sandbox env var | Yes — required by `osint-vat` |

### 8.4 GDPR Compliance

- **osint-cf** is pure local computation — no personal data leaves the sandbox
- Employee data (HR Intelligence) uses dedicated Supabase tables with RLS
- Counterpart data (company information) is business data, not personal data under GDPR
- Cache TTLs ensure stale personal-adjacent data is refreshed periodically
- The Supabase service role key bypasses RLS by design — access control is enforced
  at the frontend layer via Supabase Auth + RLS policies

---

## 9. Deployment

### 9.1 Docker Compose Stacks

| Stack | File | Services |
|-------|------|----------|
| Nebula | `nebula/docker-compose.yml` | llama-server-orchestrator, llama-server-worker, llama-server-ocr, litellm-proxy |
| NemoClaw | `nemoclaw/docker-compose.yml` | openshell-gateway |

Both stacks are deployed via **Dokploy**. Push to `main` → Dokploy redeploys.

### 9.2 First-Time Setup

```bash
# 1. Create the shared Docker network
./nebula/create-network.sh

# 2. Configure environment
cp nebula/.env.example nebula/.env       # edit model paths
cp nemoclaw/.env.example nemoclaw/.env   # edit gateway config

# 3. Deploy Nebula inference stack
cd nebula && docker compose up -d

# 4. Onboard NemoClaw (guided wizard: gateway + provider + sandbox + policy)
nemoclaw onboard

# 5. Upload skills, workspace, env vars, cron
cd nemoclaw && ./setup.sh
```

The `setup.sh` script (run after `nemoclaw onboard`) performs:

1. Wait for OpenShell gateway health
2. Upload all 10 skills into `/sandbox/.openclaw/skills/`
3. Upload workspace files into `/sandbox/.openclaw/workspace/`
4. Set Supabase and VIES credentials as sandbox env vars
5. Configure BandoRadar cron (06:00/06:30/07:00)

> **Note:** `nemoclaw onboard` handles gateway startup, CLI install, provider registration,
> sandbox creation, inference routing, and policy application. `setup.sh` handles the
> project-specific uploads and configuration.

### 9.3 Model Storage

Host path: `/home/ppezz/models/`

| Directory | Model File | Size |
|-----------|-----------|------|
| `nemotron-orchestrator/` | `orchestrator-8b-claude-4.5-opus-distill.q4_k_m.gguf` | ~5 GB |
| `nemotron-nano-worker/` | `NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf` | ~2.5 GB |
| `nemotron-vl/` | `NVIDIA-Nemotron-Nano-12B-v2-VL-Q4_K_M.gguf` + mmproj | ~7 GB |
| `numarkdown/` | `NuMarkdown-8B-Thinking.Q4_K_M.gguf` + mmproj Q8_0 | ~5 GB |

Models are mounted **read-only** into containers.

### 9.4 Environment Variables

#### Nebula (`nebula/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `ORCHESTRATOR_MODEL_PATH` | — | Host path to orchestrator model directory |
| `ORCHESTRATOR_MODEL_FILE` | — | GGUF filename |
| `ORCHESTRATOR_CTX_SIZE` | 32768 | Context window tokens |
| `ORCHESTRATOR_THREADS` | 24 | CPU threads |
| `ORCHESTRATOR_MEMORY_LIMIT` | 10G | Container memory cap |
| `ORCHESTRATOR_PORT` | 8083 | Host port |
| `ORCHESTRATOR_REASONING_BUDGET` | 1024 | Max reasoning tokens |
| `WORKER_MODEL_PATH` | — | Host path to worker model |
| `WORKER_MODEL_FILE` | — | GGUF filename |
| `WORKER_CTX_SIZE` | 16384 | Context window |
| `WORKER_THREADS` | 16 | CPU threads |
| `WORKER_MEMORY_LIMIT` | 6G | Container memory cap |
| `WORKER_PORT` | 8084 | Host port |
| `WORKER_REASONING_BUDGET` | 512 | Max reasoning tokens |
| `OCR_CTX_SIZE` | 4096 | OCR context window |
| `OCR_THREADS` | 8 | CPU threads |
| `OCR_MEMORY_LIMIT` | 10G | Container memory cap |
| `OCR_PORT` | 8086 | Host port |
| `LITELLM_PORT` | 4000 | Proxy port |
| `LITELLM_DROP_PARAMS` | true | Drop unsupported params silently |
| `LITELLM_MEMORY_LIMIT` | 2G | Proxy memory cap |

#### NemoClaw (`nemoclaw/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENSHELL_GATEWAY` | terminia-gateway | Gateway name |
| `OPENSHELL_PORT` | 30051 | Internal gateway port |
| `GATEWAY_HOST_PORT` | 18789 | Host-mapped port (NemoClaw default) |
| `INFERENCE_PROVIDER` | litellm | Provider name |
| `INFERENCE_ENDPOINT` | `http://litellm-proxy:4000` | LiteLLM URL |
| `INFERENCE_MODEL` | nemotron-orchestrator | Default model |

#### Sandbox Environment (set via `openshell sandbox connect`)

| Variable | Purpose |
|----------|---------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (bypasses RLS) |
| `VIES_API_KEY` | EU VIES API key |

### 9.5 Health Checks

```bash
curl http://localhost:8083/health   # orchestrator
curl http://localhost:8084/health   # worker
curl http://localhost:8086/health   # OCR
curl http://localhost:4000/health   # litellm-proxy
curl http://localhost:18789/health  # openshell-gateway
```

---

## 10. External Integrations

| Source | Data | Method | Cost | Rate Limits | Used By |
|--------|------|--------|------|-------------|---------|
| **ANAC OpenData** | Italian public procurement tenders | REST/CSV download from `dati.anticorruzione.it` | Free | None known | `bandi-sync-anac` |
| **TED Europa** | EU procurement notices (Italy filter) | REST API at `api.ted.europa.eu` | Free | Fair use | `bandi-sync-ted` |
| **VIES** | EU VAT number validation | REST API at `ec.europa.eu` | Free | ~100 req/min | `osint-vat` |
| **ANAC Casellario** | Supplier annotations/exclusions | Web scraping of `casellario.anticorruzione.it` | Free | Scraping — be respectful | `osint-anac-casellario` |
| **Codice Fiscale** | Italian fiscal code validation | Local algorithm (no API) | Free | N/A | `osint-cf` |
| **Supabase** | PostgreSQL + Storage + Auth | Client library (`@supabase/supabase-js`) | Per plan | Per plan | All skills |

### Priority & Reliability

| Integration | Priority | Reliability | Fallback |
|-------------|----------|-------------|----------|
| Supabase | Critical | High (managed SaaS) | None — skills fail without it |
| VIES API | High | Medium (EU infra, occasional downtime) | Cache (30d TTL) + graceful error |
| ANAC OpenData | Medium | Medium | Cache in `bandi` table; retry next day |
| TED Europa | Medium | High (EU infra) | Cache in `bandi` table; retry next day |
| ANAC Casellario | Low | Low (scraping, page changes) | Graceful degradation, stale cache (7d) |
| CF Algorithm | High | Perfect (local computation) | N/A |
