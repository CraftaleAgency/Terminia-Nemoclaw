# Network Architecture

## Inference Routing

```
┌─────────────────────────────────────────────────────┐
│  OpenClaw Agent (inside sandbox)                    │
│  Talks to: inference.local                          │
└──────────────────────┬──────────────────────────────┘
                       │ (intercepted by OpenShell)
                       ▼
┌─────────────────────────────────────────────────────┐
│  OpenShell Gateway (openshell-gateway:30051)        │
│  Routes inference to configured provider            │
│  Enforces network policy (deny-by-default)          │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  LiteLLM Proxy (litellm-proxy:4000)                 │
│  OpenAI-compatible gateway                          │
│  Routes model names → backend servers               │
└──────────┬──────────────────────┬───────────────────┘
           │                      │
           ▼                      ▼
┌──────────────────┐  ┌──────────────────────┐
│  Orchestrator    │  │  Worker              │
│  :8080 (→8083)   │  │  :8080 (→8084)       │
│  Nemotron-8B     │  │  Nemotron-3-Nano-4B  │
└──────────────────┘  └──────────────────────┘
```

## Network Topology

```
External Access (HTTPS via Cloudflare Tunnel)
    │
    ├── ai.pezserv.org ────────────→ litellm-proxy:4000
    ├── ai-dashboard.pezserv.org ──→ openwebui:8080
    ├── vane.pezserv.org ──────────→ vane:3000
    └── nemoclaw.pezserv.org ──────→ openshell-gateway:30051 (optional)

┌───────────────────────────────────────────────────────┐
│           llmserver-ai-network (172.28.0.0/16)        │
│                                                       │
│  ┌──────────────────────┐  ┌───────────────────────┐ │
│  │ llama-server-         │  │ llama-server-worker   │ │
│  │ orchestrator :8080    │  │ :8080                 │ │
│  │ (host 8083)           │  │ (host 8084)           │ │
│  └──────────┬────────────┘  └──────────┬────────────┘ │
│             └──────────┬───────────────┘              │
│                        ▼                              │
│             ┌──────────────────┐                      │
│             │ litellm-proxy    │                      │
│             │ :4000            │                      │
│             └────────┬─────────┘                      │
│                      │                                │
│      ┌───────────────┼───────────────┐                │
│      ▼               ▼               ▼                │
│  ┌──────────┐ ┌───────────┐ ┌──────────────────┐    │
│  │openwebui │ │   vane    │ │ openshell-gateway │    │
│  │ :8080    │ │   :3000   │ │ :30051 (host 8082)│    │
│  └──────────┘ └───────────┘ └────────┬─────────┘    │
│                                      │               │
│                             ┌────────▼─────────┐     │
│                             │ OpenClaw sandbox  │     │
│                             │ (managed by gw)   │     │
│                             └──────────────────┘     │
└───────────────────────────────────────────────────────┘
         ↕
┌───────────────────────────────────────────────────────┐
│              dokploy-network (10.0.1.0/24)            │
│  Traefik reverse proxy for external routing           │
└───────────────────────────────────────────────────────┘
```

## Networks

| Network | Subnet | Purpose |
|---------|--------|---------|
| `llmserver-ai-network` | 172.28.0.0/16 | Internal AI service communication |
| `dokploy-network` | 10.0.1.0/24 | Traefik integration for external access |

## Ports

| Port | Service | Exposure |
|------|---------|----------|
| 8083 | llama-server-orchestrator | Host only |
| 8084 | llama-server-worker | Host only |
| 4000 | litellm-proxy | Host + Cloudflare (ai.pezserv.org) |
| 8082 | openshell-gateway | Host only (optionally Cloudflare) |

## Cloudflare Tunnel Config

Add these routes to the existing Cloudflare tunnel:

```yaml
ingress:
  - hostname: ai.pezserv.org
    service: http://litellm-proxy:4000
  - hostname: nemoclaw.pezserv.org
    service: http://openshell-gateway:30051
  - service: http_status:404
```

## Setup

```bash
./nebula/create-network.sh
```

Creates the `llmserver-ai-network` bridge. All compose files reference it as `external: true`.
