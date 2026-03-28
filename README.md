# Terminia-Nemoclaw

AI infrastructure and agent platform for the Terminia ecosystem.

## Services

### Nebula — AI Inference Infrastructure

All inference services in a single compose (`nebula/docker-compose.yml`):

| Service | Container | Port | Model |
|---------|-----------|------|-------|
| Orchestrator | `llama-server-orchestrator` | 8083 | Nemotron-Orchestrator-8B (Claude 4.5 Opus Distill) |
| Worker | `llama-server-worker` | 8084 | Nemotron-3-Nano-4B |
| LiteLLM Proxy | `litellm-proxy` | 4000 | — (routes to above) |

### NemoClaw — Sandboxed AI Agent Platform

[NVIDIA NemoClaw](https://docs.nvidia.com/nemoclaw/latest/) runs [OpenClaw](https://openclaw.ai) agents inside [OpenShell](https://github.com/NVIDIA/OpenShell) sandboxes with security guardrails.

| Component | Container | Port | Purpose |
|-----------|-----------|------|---------|
| OpenShell Gateway | `openshell-gateway` | 8082 | Sandbox runtime, inference routing, policy enforcement |

**Architecture** — the gateway manages the full sandbox lifecycle. Sandboxes are created via `nemoclaw` CLI (installed on host), not as compose services:

```
Agent (sandbox) → inference.local → OpenShell gateway → litellm-proxy:4000 → llama-server
```

- Inference credentials stay on the host; sandbox never sees raw API keys
- Network egress is deny-by-default; operator approves via `openshell term` TUI
- Filesystem: `/sandbox` and `/tmp` are writable, everything else read-only
- Workspace files (SOUL.md, USER.md, MEMORY.md) persist in `/sandbox/.openclaw/workspace/`

## Deployment

### Via Dokploy (recommended)

Point Dokploy compose stacks at:
- **Nebula**: `nebula/docker-compose.yml`
- **NemoClaw**: `nemoclaw/docker-compose.yml`

Push to `main` → Dokploy redeploys.

### Cloudflare Tunnel

External access routes through Cloudflare tunnel → Traefik:

| Domain | Service |
|--------|---------|
| `ai.pezserv.org` | litellm-proxy:4000 |
| `nemoclaw.pezserv.org` | openshell-gateway:30051 (if exposed) |

### First-time setup

```bash
# 1. Create the shared network
./nebula/create-network.sh

# 2. Deploy Nebula inference stack
cd nebula && docker compose up -d

# 3. Deploy NemoClaw gateway
cd ../nemoclaw && docker compose up -d

# 4. Install CLI + create sandbox + configure provider
./setup.sh
```

### Health checks

```bash
curl http://localhost:8083/health   # orchestrator
curl http://localhost:8084/health   # worker
curl http://localhost:4000/health   # litellm-proxy
curl http://localhost:8082/health   # nemoclaw gateway
```

### NemoClaw management

```bash
nemoclaw terminia-sandbox connect     # enter sandbox
nemoclaw terminia-sandbox status      # check health + inference
nemoclaw terminia-sandbox logs -f     # stream logs
openshell term                        # TUI: monitor + approve egress

# Switch inference model at runtime (no restart)
openshell inference set --provider litellm --model nemotron-nano
```

## ⚠️ Known Issue: Nemotron-3-Nano-4B

The worker uses `nemotron_h` (hybrid Mamba-Transformer) architecture, unsupported by the `ik_llama.cpp` fork currently used for `local/llama-server:latest`. Rebuild from official llama.cpp:

```bash
git clone --depth 1 https://github.com/ggml-org/llama.cpp /tmp/llama-official
cd /tmp/llama-official
docker build -t local/llama-server:latest .
```

## Model Storage

Host path: `/home/ppezz/models/`

| Directory | Model | Size |
|-----------|-------|------|
| `nemotron-orchestrator/` | orchestrator-8b-claude-4.5-opus-distill.q4_k_m.gguf | ~5 GB |
| `nemotron-nano-worker/` | NVIDIA-Nemotron3-Nano-4B-Q4_K_M.gguf | ~2.5 GB |

## Monitoring

Operational logs, health checks, and incident reports are tracked in [CraftOps](https://github.com/CraftaleAgency/CraftOps) under `projects/nebula/` and `summary/nemoclaw/`.
