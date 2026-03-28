# Checkpoint 005 — TypeScript Migration & Prod Readiness

**Date**: 2026-03-28
**Branch**: main

## Summary
Full TypeScript migration of the NemoClaw backend using Node 22's native `--experimental-strip-types`. Added `supabase.terminia.it` to OpenClaw network policy. Typed Supabase clients with `Database` generic across all skills and API.

## Changes

### TypeScript Conversion
- **API** (10 files): server.ts, types.ts, lib/supabase.ts, lib/inference.ts, lib/database.ts, middleware/auth.ts, routes/analyze.ts, osint.ts, chat.ts, ocr.ts
- **Skills shared** (4 files): database.ts, supabase-client.ts, cache.ts, utils.ts
- **Skill handlers** (10 files): All handler.js → handler.ts with typed interfaces
- **Dockerfile**: `node:20-alpine` → `node:22-alpine` + `--experimental-strip-types`
- Zero `.js` files remain outside `node_modules/`

### Network Policy
- `supabase.terminia.it:443` added to `nemoclaw/policies/openclaw-sandbox.yaml`

### Environment
- `SUPABASE_URL=https://supabase.terminia.it` added to `.env` + `.env.example`
- `CORS_ORIGINS` expanded with `https://terminia.it`

## Architecture
```
Client → Cloudflare Tunnel → terminia-api (Node 22 TS) → LiteLLM → llama-servers
                                    ↓
                            Supabase (supabase.terminia.it)
                                    ↑
                    OpenShell Gateway → NemoClaw Sandbox → Skill handlers (TS)
```

## Verification
- All API `.ts` imports verified with `node --experimental-strip-types`
- All 10 skill handlers syntax-checked
- Committed as `bd5bb47`, pushed to `origin/main`
