# Copilot Instructions — Terminia-Nemoclaw

AI infrastructure and sandboxed agent platform. Two independently deployed stacks:
- **Nebula** (`nebula/`) — llama.cpp inference servers + LiteLLM proxy
- **NemoClaw** (`nemoclaw/`) — OpenShell gateway managing OpenClaw agent sandboxes

## Architecture

```
OpenClaw agent (sandbox)
  → inference.local (intercepted by OpenShell)
  → openshell-gateway:30051
  → litellm-proxy:4000
  → llama-server-orchestrator:8080 (Nemotron-8B, port 8083)
  → llama-server-worker:8080 (Nemotron-Nano-4B, port 8084)
```

Both stacks share `llmserver-ai-network` (172.28.0.0/16) and attach to `dokploy-network` (Traefik). The network **must exist before deploying either stack** — create it with `./nebula/create-network.sh`.

Sandboxes are **not** compose services. They are created and managed by the `nemoclaw` CLI on the host; the gateway container manages their lifecycle via the Docker socket.

## Deployment

Both stacks deploy via Dokploy pointing at their respective `docker-compose.yml`. Push to `main` triggers redeployment.

### First-time setup
```bash
./nebula/create-network.sh          # create shared bridge network (once)
cd nebula && docker compose up -d   # inference stack
cd ../nemoclaw && docker compose up -d && ./setup.sh  # gateway + CLI + sandbox
```

### Health checks
```bash
curl http://localhost:8083/health   # orchestrator
curl http://localhost:8084/health   # worker
curl http://localhost:4000/health   # litellm-proxy
curl http://localhost:8082/health   # nemoclaw gateway
```

### Sandbox management
```bash
nemoclaw terminia-sandbox connect     # enter sandbox
nemoclaw terminia-sandbox status      # health + inference check
nemoclaw terminia-sandbox logs -f     # stream logs
openshell term                        # TUI: monitor + approve egress

# Switch model at runtime (no restart needed)
openshell inference set --provider litellm --model nemotron-nano
```

## Configuration

Each stack has its own `.env` (gitignored). Copy from `.env.example`:
- `nebula/.env.example` — model paths, ports, memory limits, thread counts
- `nemoclaw/.env.example` — gateway port, inference endpoint, Cloudflare domain

LiteLLM model routing is defined in `nebula/litellm-config.yaml`. Model aliases:
- `default` / `nemotron-orchestrator` → orchestrator (8083)
- `nemotron-nano` / `fast` → worker (8084)

## Sandbox Security Policy

`nemoclaw/policies/openclaw-sandbox.yaml` defines the active network + filesystem policy:
- **Filesystem**: `/sandbox` and `/tmp` are read-write; everything else read-only
- **Network**: deny-by-default; only `inference.local`, `github.com`, `api.github.com`, `clawhub.com`, `openclaw.ai`, and `registry.npmjs.org` are whitelisted by binary
- Unlisted egress requires operator approval via `openshell term`

Applied during setup via `openshell policy set nemoclaw/policies/openclaw-sandbox.yaml`

## Known Issue: Nemotron-3-Nano-4B Worker

The worker uses `nemotron_h` (hybrid Mamba-Transformer) architecture, **unsupported by `ik_llama.cpp`** (the `local/llama-server:latest` image). Rebuild from official llama.cpp before deploying the worker:

```bash
git clone --depth 1 https://github.com/ggml-org/llama.cpp /tmp/llama-official
cd /tmp/llama-official && docker build -t local/llama-server:latest .
```

## Model Storage

Host path: `/home/ppezz/models/`

| Directory | File |
|-----------|------|
| `nemotron-orchestrator/` | `orchestrator-8b-claude-4.5-opus-distill.q4_k_m.gguf` |
| `nemotron-nano-worker/` | `NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf` |

## External Access

Cloudflare tunnel → Traefik → services:

| Domain | Service |
|--------|---------|
| `ai.pezserv.org` | `litellm-proxy:4000` |
| `nemoclaw.pezserv.org` | `openshell-gateway:30051` (optional) |

## OpenClaw Skills

Agent skills live in `skills/` and are deployed to the sandbox at `/sandbox/.openclaw/skills/` during `setup.sh`. Each skill has a `SKILL.md` (definition) and `handler.js` (implementation).

### Shared modules (`skills/_shared/`)
- `supabase-client.js` — Supabase client initialized with service role key (env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- `cache.js` — `getCached(table, key, value, tsColumn, ttlMinutes)` / `setCache(table, data, conflictCol)` for API result caching in Supabase
- `utils.js` — `callInference(system, user, opts)` for LLM calls via `inference.local`, `parseInferenceJSON()`, `computeReliabilityScore()`, `computeMatchScore()`, score helpers

### Contract pipeline (sequential)
1. **contract-classify** — PDF text → contract type + party identification via inference
2. **contract-extract** — Deep extraction: clauses, obligations, milestones, scope, counterpart IDs
3. **contract-risk-score** — Rules engine + inference scoring (0-100), alert generation

### OSINT skills (triggered by contract pipeline)
- **osint-cf** — Local Italian Codice Fiscale validation (pure algorithm, no API)
- **osint-vat** — EU VAT validation via VIES REST API (cache 30 days)
- **osint-anac-casellario** — ANAC supplier annotation scraping (cache 7 days, fragile)

### BandoRadar skills (cron-triggered daily)
- **bandi-sync-anac** — Import tenders from ANAC OpenData (CSV/JSON), dedup by CIG
- **bandi-sync-ted** — Import EU tenders from TED Europa API, dedup by notice ID
- **bandi-match** — 5-dimension match scoring (sector/size/geo/requirements/feasibility), alerts for >80%

### Skill development conventions
- ES module syntax (`import`/`export`)
- Each handler exports `async handler(input)` returning a result object
- Use `callInference()` from `_shared/utils.js` for all LLM calls (routes through `inference.local`)
- Italian-first prompts for contract analysis; structured JSON output
- All DB access via Supabase service role key — never expose to frontend
- Cache external API results in Supabase with TTL to minimize calls
- Graceful degradation: return partial results with `error` field on failure
