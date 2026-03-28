#!/bin/bash
# NemoClaw setup — installs CLI and onboards with litellm-proxy as inference provider.
# Run on the HOST, not inside a container.
# Ref: https://docs.nvidia.com/nemoclaw/latest/get-started/quickstart.html
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🚀 NemoClaw Setup for Terminia"
echo "==============================="
echo ""

# Step 1: Ensure OpenShell gateway is running
echo "📦 Step 1: Starting OpenShell gateway..."
docker compose up -d openshell-gateway

echo "⏳ Waiting for gateway..."
max_attempts=30
attempt=1
while [ $attempt -le $max_attempts ]; do
    if curl -sf http://localhost:8082/health > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Gateway healthy${NC}"
        break
    fi
    echo "  attempt $attempt/$max_attempts"
    sleep 2
    ((attempt++))
done

if [ $attempt -gt $max_attempts ]; then
    echo -e "${RED}✗ Gateway failed to start${NC}"
    echo "Check logs: docker compose logs openshell-gateway"
    exit 1
fi
echo ""

# Step 2: Install NemoClaw CLI on host (if not present)
if ! command -v nemoclaw &> /dev/null; then
    echo "📥 Step 2: Installing NemoClaw CLI..."
    curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
    echo ""
else
    echo -e "📥 Step 2: NemoClaw CLI already installed ($(nemoclaw --version 2>/dev/null || echo 'unknown'))"
    echo ""
fi

# Step 3: Configure inference provider (litellm-proxy, OpenAI-compatible)
echo "🔧 Step 3: Configuring inference provider..."
echo "  Provider type: OpenAI-compatible"
echo "  Endpoint: http://litellm-proxy:4000"
echo "  Model: nemotron-orchestrator (via litellm-proxy)"
echo ""

openshell provider create \
    --name litellm \
    --type openai \
    --credential OPENAI_API_KEY=dummy \
    --config OPENAI_BASE_URL=http://litellm-proxy:4000 2>/dev/null || \
    echo -e "${YELLOW}⚠ Provider may already exist — run 'openshell provider list' to verify${NC}"
echo ""

# Step 4: Create sandbox
echo "🏗️  Step 4: Creating sandbox..."
echo "  Name: terminia-sandbox"
echo "  Image: ghcr.io/nvidia/openshell-community/sandboxes/openclaw:latest (~2.4 GB)"
echo ""

openshell sandbox create terminia-sandbox 2>/dev/null || \
    echo -e "${YELLOW}⚠ Sandbox may already exist — run 'openshell sandbox list' to verify${NC}"
echo ""

# Step 5: Configure inference route
echo "🔗 Step 5: Setting inference route..."
openshell inference set \
    --provider litellm \
    --model nemotron-orchestrator 2>/dev/null || \
    echo -e "${YELLOW}⚠ Inference route configuration may need manual setup${NC}"
echo ""

# Step 6: Apply network policy (if custom policy exists)
POLICY_FILE="$(dirname "$0")/policies/openclaw-sandbox.yaml"
if [ -f "$POLICY_FILE" ]; then
    echo "🛡️  Step 6: Applying network policy..."
    openshell policy set "$POLICY_FILE" 2>/dev/null || \
        echo -e "${YELLOW}⚠ Policy application failed — apply manually: openshell policy set $POLICY_FILE${NC}"
else
    echo "🛡️  Step 6: No custom policy file — using default deny-by-default policy"
fi
echo ""

echo -e "${GREEN}✅ Setup complete${NC}"
echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  Gateway:    http://localhost:8082                      │"
echo "│  Health:     http://localhost:8082/health               │"
echo "│  Inference:  litellm-proxy:4000 → llama-server:8083    │"
echo "└─────────────────────────────────────────────────────────┘"
echo ""
echo "Commands:"
echo "  nemoclaw terminia-sandbox connect     Connect to sandbox"
echo "  nemoclaw terminia-sandbox status      Check status"
echo "  nemoclaw terminia-sandbox logs -f     Stream logs"
echo "  openshell term                        TUI for monitoring & egress approval"
echo ""
echo "Inside sandbox:"
echo "  openclaw tui                          Interactive chat"
echo "  openclaw agent --agent main --local -m 'hello' --session-id test"
