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

# Step 7: Deploy Terminia skills into sandbox
SKILLS_DIR="$(dirname "$0")/../skills"
SANDBOX_SKILLS_DIR="/sandbox/.openclaw/skills"
if [ -d "$SKILLS_DIR" ]; then
    echo "📦 Step 7: Deploying Terminia skills..."
    echo "  Source: $SKILLS_DIR"
    echo "  Target: $SANDBOX_SKILLS_DIR (inside sandbox)"
    echo ""

    # Copy skills into sandbox via nemoclaw exec
    nemoclaw terminia-sandbox exec -- mkdir -p "$SANDBOX_SKILLS_DIR" 2>/dev/null || true

    for skill_dir in "$SKILLS_DIR"/*/; do
        skill_name=$(basename "$skill_dir")
        echo "  → $skill_name"
        nemoclaw terminia-sandbox cp "$skill_dir" "$SANDBOX_SKILLS_DIR/$skill_name/" 2>/dev/null || \
            echo -e "${YELLOW}    ⚠ Failed to copy $skill_name${NC}"
    done

    # Install skills with OpenClaw (if openclaw CLI available inside sandbox)
    echo ""
    echo "  Registering skills..."
    nemoclaw terminia-sandbox exec -- openclaw skill install --path "$SANDBOX_SKILLS_DIR" 2>/dev/null || \
        echo -e "${YELLOW}  ⚠ Skill registration failed — skills are copied but may need manual registration${NC}"
    echo ""
else
    echo "📦 Step 7: No skills directory found — skipping skill deployment"
    echo ""
fi

# Step 8: Configure sandbox environment variables
echo "🔑 Step 8: Setting sandbox environment variables..."

if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    nemoclaw terminia-sandbox env set SUPABASE_URL="$SUPABASE_URL" 2>/dev/null || \
        echo -e "${YELLOW}  ⚠ Failed to set SUPABASE_URL${NC}"
    nemoclaw terminia-sandbox env set SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null || \
        echo -e "${YELLOW}  ⚠ Failed to set SUPABASE_SERVICE_ROLE_KEY${NC}"
    echo -e "  ${GREEN}✓ Supabase credentials configured${NC}"
else
    echo -e "  ${YELLOW}⚠ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY not set in host environment${NC}"
    echo "    Export them before running setup, or set manually:"
    echo "    nemoclaw terminia-sandbox env set SUPABASE_URL=https://your-project.supabase.co"
    echo "    nemoclaw terminia-sandbox env set SUPABASE_SERVICE_ROLE_KEY=your-key"
fi

if [ -n "$VIES_API_KEY" ]; then
    nemoclaw terminia-sandbox env set VIES_API_KEY="$VIES_API_KEY" 2>/dev/null || \
        echo -e "${YELLOW}  ⚠ Failed to set VIES_API_KEY${NC}"
    echo -e "  ${GREEN}✓ VIES API key configured${NC}"
else
    echo -e "  ${YELLOW}⚠ VIES_API_KEY not set — osint-vat skill will not work${NC}"
fi
echo ""

# Step 9: Configure BandoRadar cron (daily sync)
echo "⏰ Step 9: Configuring BandoRadar daily sync..."
nemoclaw terminia-sandbox exec -- sh -c \
    'echo "0 6 * * * cd /sandbox/.openclaw/skills && node --input-type=module -e \"import(\\\"./bandi-sync-anac/handler.js\\\").then(m=>m.handler({}).then(console.log))\" >> /tmp/bandi-sync.log 2>&1
30 6 * * * cd /sandbox/.openclaw/skills && node --input-type=module -e \"import(\\\"./bandi-sync-ted/handler.js\\\").then(m=>m.handler({}).then(console.log))\" >> /tmp/bandi-sync.log 2>&1
0 7 * * * cd /sandbox/.openclaw/skills && node --input-type=module -e \"import(\\\"./bandi-match/handler.js\\\").then(m=>m.handler({}).then(console.log))\" >> /tmp/bandi-match.log 2>&1" | crontab -' 2>/dev/null || \
    echo -e "${YELLOW}⚠ Cron setup failed — configure manually inside sandbox${NC}"
echo "  Schedule: 06:00 ANAC sync → 06:30 TED sync → 07:00 Match scoring"
echo ""

echo -e "${GREEN}✅ Setup complete${NC}"
echo ""
echo "┌─────────────────────────────────────────────────────────┐"
echo "│  Gateway:    http://localhost:8082                      │"
echo "│  Health:     http://localhost:8082/health               │"
echo "│  Inference:  litellm-proxy:4000 → llama-server:8083    │"
echo "│  Skills:     9 Terminia skills deployed                 │"
echo "│  Cron:       BandoRadar daily @ 06:00                   │"
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
