# Terminia — Dokploy Deployment Guide

All services deploy via **git push → Dokploy auto-deploy**. No docker-compose CLI on the VPS.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Tunnel (systemd)                                │
│  ─────────────────────────────────────────────────────────  │
│  supabase-terminia.pezserv.org → http://localhost:8000      │
│  nemoclaw.pezserv.org          → http://localhost:3100      │
│  terminia.pezserv.org          → http://localhost:3004      │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────▼────┐         ┌────▼────┐         ┌────▼────┐
    │ Supabase│         │NemoClaw │         │Frontend │
    │  Kong   │         │  API    │         │ Next.js │
    │  :8000  │         │  :3100  │         │  :3004  │
    └────┬────┘         └────┬────┘         └─────────┘
         │                   │
    Internal network    ┌────▼────┐
    (supabase stack)    │LiteLLM  │
                        │  :4000  │
                        └────┬────┘
                        ┌────▼────┐
                        │ LLama   │
                        │  :8080  │
                        └─────────┘
```

## Docker Networks

| Network | Purpose | Services |
|---------|---------|----------|
| `dokploy-network` | Dokploy + Traefik routing | All exposed services |
| `llmserver-ai-network` | AI inter-service comms | terminia-api, litellm-proxy, llama-server, openshell-gateway |
| `terminia-supabase-nmyjx8` | Supabase internal | All supabase services (kong, auth, db, etc.) |

## Service 1: NemoClaw Gateway + API

**Dokploy service**: `terminia-nemoclawgateway-ma9kw4` (Compose)
**Source**: `Terminia-Nemoclaw` repo → `nemoclaw/docker-compose.yml`
**Branch**: `main`

### Env vars (set in Dokploy UI)

| Variable | Value | Notes |
|----------|-------|-------|
| `OPENSHELL_GATEWAY` | `terminia-gateway` | Gateway name |
| `OPENSHELL_PORT` | `30051` | Internal gRPC port |
| `GATEWAY_HOST_PORT` | `8082` | Host-mapped gateway port |
| `API_HOST_PORT` | `3100` | Host-mapped API port |
| `SUPABASE_URL` | `https://supabase-terminia.pezserv.org` | Public kong URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` | From supabase `.env` `SERVICE_ROLE_KEY` |
| `LITELLM_API_KEY` | *(empty or key)* | If LiteLLM requires auth |
| `CORS_ORIGINS` | `http://localhost:3000,https://terminia.pezserv.org` | Allowed origins |
| `TELEGRAM_BOT_TOKEN` | `8657190812:AAGpgia...` | Telegram bot API key |

### Internal connectivity
- `terminia-api` → `litellm-proxy:4000` via `llmserver-ai-network`
- `terminia-api` → supabase via public URL (separate Docker network)

---

## Service 2: Terminia Frontend

**Dokploy service**: `terminia-frontend-7vmml3` (Application)
**Source**: `Terminia-Frontend` repo → `Dockerfile`
**Branch**: `nemoclaw`

### Env vars (set in Dokploy UI)

| Variable | Value | Notes |
|----------|-------|-------|
| `PORT` | `3004` | Next.js listen port |
| `HOSTNAME` | `0.0.0.0` | Bind to all interfaces |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://supabase-terminia.pezserv.org` | Browser-facing, must be public |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGci...anon...` | From supabase `.env` `ANON_KEY` |
| `NEMOCLAW_API_URL` | `http://terminia-api:3100` | Server-side only (rewrites proxy) |

### Notes
- `NEXT_PUBLIC_*` vars are embedded at **build time** — set them in Dokploy before building
- `NEMOCLAW_API_URL` is server-side only (Next.js rewrites), uses Docker DNS
- Frontend must be on `dokploy-network` to reach `terminia-api` by container name
- All dashboard pages use `force-dynamic` — no static prerendering at build time

---

## Service 3: Supabase

**Dokploy service**: `terminia-supabase-nmyjx8` (Compose)
**Source**: `Terminia-Nemoclaw` repo → `supabase/docker.compose.yml`
**Branch**: `main`
**Status**: ✅ Already deployed and working

### Key env vars (already filled in Dokploy)

| Variable | Description |
|----------|-------------|
| `POSTGRES_PASSWORD` | Postgres superuser password |
| `JWT_SECRET` | JWT signing secret for all supabase auth |
| `ANON_KEY` | Public anon JWT (used by frontend) |
| `SERVICE_ROLE_KEY` | Service role JWT (used by API backend) |
| `SITE_URL` | `https://terminia.pezserv.org` |
| `API_EXTERNAL_URL` | `https://supabase-terminia.pezserv.org` |
| `SUPABASE_PUBLIC_URL` | `https://supabase-terminia.pezserv.org` |
| `CONTAINER_PREFIX` | `terminia-supabase-nmyjx8` |

### Kong exposure
Kong exposes port `8000` internally. For Cloudflare tunnel access on `supabase-terminia.pezserv.org`:
- Kong must be reachable on host port `8000`
- Options: Dokploy Traefik labels (already configured), or socat proxy container

---

## Cloudflare Tunnel Config

Managed via **Cloudflare Zero Trust Dashboard** (token-based, not local config file).

| Hostname | Service | Port |
|----------|---------|------|
| `supabase-terminia.pezserv.org` | `http://localhost:8000` | Kong API gateway |
| `nemoclaw.pezserv.org` | `http://localhost:3100` | NemoClaw REST API |
| `terminia.pezserv.org` | `http://localhost:3004` | Next.js frontend |

---

## Deploy Workflow

1. Make changes locally in `~/Desktop/Terminia/`
2. `git push` to the correct branch
3. Dokploy auto-detects the push and redeploys
4. Check container status: `docker ps | grep terminia`

## Migrations

Supabase migrations live in `Terminia-Frontend/supabase/migrations/`. Run via:
```bash
# From the VPS, using docker exec
for f in supabase/migrations/*.sql; do
  docker exec -i terminia-supabase-nmyjx8-supabase-db \
    psql -U supabase_admin -d postgres < "$f"
done
```
