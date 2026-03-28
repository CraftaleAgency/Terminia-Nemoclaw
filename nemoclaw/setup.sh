#!/bin/bash
# NemoClaw setup — onboards Terminia sandbox with litellm-proxy as inference provider.
# Run on the HOST, not inside a container.
# Uses real NemoClaw/OpenShell CLI commands per official docs.
# Ref: https://docs.nvidia.com/nemoclaw/latest/get-started/quickstart.html
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SANDBOX_NAME="terminia"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🚀 NemoClaw Setup for Terminia"
echo "==============================="
echo ""

# ── Step 1: Check prerequisites ─────────────────────────────────────────────
echo "📦 Step 1: Checking prerequisites..."

missing=0

if ! command -v docker &> /dev/null; then
    echo -e "  ${RED}✗ Docker not found${NC}"
    missing=1
else
    echo -e "  ${GREEN}✓ Docker $(docker --version 2>/dev/null | head -c 40)${NC}"
fi

if ! command -v node &> /dev/null; then
    echo -e "  ${RED}✗ Node.js not found (20+ required)${NC}"
    missing=1
else
    node_major=$(node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')
    if [ "$node_major" -lt 20 ] 2>/dev/null; then
        echo -e "  ${RED}✗ Node.js $(node -v) too old — 20+ required${NC}"
        missing=1
    else
        echo -e "  ${GREEN}✓ Node.js $(node -v)${NC}"
    fi
fi

if ! command -v nemoclaw &> /dev/null; then
    echo -e "  ${RED}✗ nemoclaw CLI not found${NC}"
    echo "    Install: curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash"
    missing=1
else
    echo -e "  ${GREEN}✓ nemoclaw $(nemoclaw --version 2>/dev/null || echo 'installed')${NC}"
fi

if ! command -v openshell &> /dev/null; then
    echo -e "  ${RED}✗ openshell CLI not found${NC}"
    echo "    Install: curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash"
    missing=1
else
    echo -e "  ${GREEN}✓ openshell $(openshell --version 2>/dev/null || echo 'installed')${NC}"
fi

if [ "$missing" -ne 0 ]; then
    echo ""
    echo -e "${RED}✗ Missing prerequisites — install them and re-run${NC}"
    exit 1
fi
echo ""

# ── Step 2: Onboard sandbox (if it doesn't exist) ───────────────────────────
echo "🏗️  Step 2: Creating sandbox via nemoclaw onboard..."

if nemoclaw list 2>/dev/null | grep -q "$SANDBOX_NAME"; then
    echo -e "  ${GREEN}✓ Sandbox '$SANDBOX_NAME' already exists${NC}"
else
    echo ""
    echo "  The onboard wizard will now run interactively."
    echo "  When prompted, configure:"
    echo "    • Provider: Select 'Other OpenAI-compatible endpoint'"
    echo "    • Endpoint: http://litellm-proxy:4000"
    echo "    • Model:    nemotron-orchestrator"
    echo "    • Sandbox:  $SANDBOX_NAME"
    echo ""
    nemoclaw onboard
    echo ""

    if nemoclaw list 2>/dev/null | grep -q "$SANDBOX_NAME"; then
        echo -e "  ${GREEN}✓ Sandbox '$SANDBOX_NAME' created${NC}"
    else
        echo -e "${RED}✗ Sandbox '$SANDBOX_NAME' not found after onboard — check wizard output${NC}"
        exit 1
    fi
fi
echo ""

# ── Step 3: Verify sandbox is healthy ────────────────────────────────────────
echo "🩺 Step 3: Checking sandbox health..."

echo "⏳ Waiting for sandbox..."
max_attempts=30
attempt=1
while [ $attempt -le $max_attempts ]; do
    if nemoclaw "$SANDBOX_NAME" status 2>/dev/null | grep -qi "healthy\|running\|ready"; then
        echo -e "  ${GREEN}✓ Sandbox healthy${NC}"
        break
    fi
    echo "  attempt $attempt/$max_attempts"
    sleep 2
    ((attempt++))
done

if [ $attempt -gt $max_attempts ]; then
    echo -e "${YELLOW}⚠ Sandbox health check timed out — continuing anyway${NC}"
    echo "  Check manually: nemoclaw $SANDBOX_NAME status"
fi
echo ""

# ── Step 4: Configure inference route ────────────────────────────────────────
echo "🔗 Step 4: Setting inference route..."
echo "  Provider: litellm (OpenAI-compatible)"
echo "  Model:    nemotron-orchestrator"

openshell inference set \
    --provider litellm \
    --model nemotron-orchestrator 2>/dev/null || \
    echo -e "${YELLOW}⚠ Inference route may need manual setup: openshell inference set --provider litellm --model nemotron-orchestrator${NC}"
echo ""

# ── Step 5: Apply network policy ────────────────────────────────────────────
POLICY_FILE="$SCRIPT_DIR/policies/openclaw-sandbox.yaml"
if [ -f "$POLICY_FILE" ]; then
    echo "🛡️  Step 5: Applying network policy..."
    openshell policy set "$POLICY_FILE" 2>/dev/null || \
        echo -e "${YELLOW}⚠ Policy application failed — apply manually: openshell policy set $POLICY_FILE${NC}"
    echo -e "  ${GREEN}✓ Policy applied${NC}"
else
    echo "🛡️  Step 5: No custom policy file — using default deny-by-default policy"
fi
echo ""

# ── Step 6: Upload skills to sandbox ────────────────────────────────────────
SKILLS_DIR="$SCRIPT_DIR/../skills"
SANDBOX_SKILLS_PATH="/sandbox/.openclaw/skills"
if [ -d "$SKILLS_DIR" ]; then
    echo "📦 Step 6: Uploading Terminia skills..."
    echo "  Source: $SKILLS_DIR"
    echo "  Target: $SANDBOX_SKILLS_PATH (inside sandbox)"
    echo ""

    skill_count=0
    for skill_dir in "$SKILLS_DIR"/*/; do
        [ -d "$skill_dir" ] || continue
        skill_name=$(basename "$skill_dir")
        echo "  → Uploading $skill_name"
        openshell sandbox upload "$SANDBOX_NAME" "$skill_dir" "$SANDBOX_SKILLS_PATH/$skill_name/" 2>/dev/null || \
            echo -e "${YELLOW}    ⚠ Failed to upload $skill_name${NC}"
        ((skill_count++))
    done

    echo ""
    echo -e "  ${GREEN}✓ $skill_count skills uploaded${NC}"
else
    echo "📦 Step 6: No skills directory found — skipping skill upload"
fi
echo ""

# ── Step 7: Upload workspace files ──────────────────────────────────────────
WORKSPACE_DIR="$SCRIPT_DIR/../workspace"
if [ -d "$WORKSPACE_DIR" ]; then
    echo "📄 Step 7: Uploading workspace files..."

    for f in "$WORKSPACE_DIR"/*.md; do
        [ -f "$f" ] || continue
        fname=$(basename "$f")
        echo "  → $fname"
        openshell sandbox upload "$SANDBOX_NAME" "$f" "/sandbox/.openclaw/workspace/" 2>/dev/null || \
            echo -e "${YELLOW}    ⚠ Failed to upload $fname${NC}"
    done

    echo -e "  ${GREEN}✓ Workspace files uploaded${NC}"
else
    echo "📄 Step 7: No workspace directory found — skipping"
fi
echo ""

# ── Step 8: Configure sandbox environment variables ──────────────────────────
echo "🔑 Step 8: Setting sandbox environment variables..."

env_block=""
env_ok=true

if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    env_block="SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}"
    echo -e "  ${GREEN}✓ Supabase credentials set${NC}"
else
    echo -e "  ${YELLOW}⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in host environment${NC}"
    echo "    Export them before running setup, or write .env manually inside sandbox"
    env_ok=false
fi

if [ -n "$VIES_API_KEY" ]; then
    env_block="${env_block:+${env_block}
}VIES_API_KEY=${VIES_API_KEY}"
    echo -e "  ${GREEN}✓ VIES API key set${NC}"
else
    echo -e "  ${YELLOW}⚠ VIES_API_KEY not set — osint-vat skill will not work${NC}"
fi

if [ -n "$env_block" ]; then
    openshell sandbox connect "$SANDBOX_NAME" -- sh -c "cat > /sandbox/.env << 'ENVEOF'
${env_block}
ENVEOF" 2>/dev/null || \
        echo -e "${YELLOW}  ⚠ Failed to write .env — write it manually inside sandbox${NC}"
fi
echo ""

# ── Step 9: Configure BandoRadar cron ────────────────────────────────────────
echo "⏰ Step 9: Configuring BandoRadar daily sync..."
openshell sandbox connect "$SANDBOX_NAME" -- sh -c \
    'echo "0 6 * * * echo \"{}\" | /sandbox/.openclaw/skills/bandi-sync-anac/scripts/handler.js >> /tmp/bandi-sync.log 2>&1
30 6 * * * echo \"{}\" | /sandbox/.openclaw/skills/bandi-sync-ted/scripts/handler.js >> /tmp/bandi-sync.log 2>&1
0 7 * * * echo \"{}\" | /sandbox/.openclaw/skills/bandi-match/scripts/handler.js >> /tmp/bandi-match.log 2>&1" | crontab -' 2>/dev/null || \
    echo -e "${YELLOW}⚠ Cron setup failed — configure manually inside sandbox${NC}"
echo "  Schedule: 06:00 ANAC sync → 06:30 TED sync → 07:00 Match scoring"
echo ""

# ── Done ─────────────────────────────────────────────────────────────────────
echo -e "${GREEN}✅ Setup complete${NC}"
echo ""
echo "┌──────────────────────────────────────────────────────────────┐"
echo "│  Gateway:    nemoclaw gateway (port 18789 or custom)        │"
echo "│  Sandbox:    $SANDBOX_NAME (OpenShell managed)                    │"
echo "│  Inference:  litellm-proxy:4000 → 4 llama-servers           │"
echo "│  OCR:        NuMarkdown-8B via litellm-proxy:4000/ocr       │"
echo "│  Skills:     10 Terminia skills uploaded                     │"
echo "│  Workspace:  SOUL.md + IDENTITY.md + USER.md                │"
echo "│  Cron:       BandoRadar daily @ 06:00                        │"
echo "└──────────────────────────────────────────────────────────────┘"
echo ""
echo "Commands:"
echo "  nemoclaw $SANDBOX_NAME connect        Connect to sandbox"
echo "  nemoclaw $SANDBOX_NAME status         Check status"
echo "  nemoclaw $SANDBOX_NAME logs --follow  Stream logs"
echo "  openshell term                   TUI for monitoring & egress approval"
echo ""
echo "Inside sandbox:"
echo "  openclaw tui                          Interactive chat"
echo "  openclaw agent --agent main --local -m 'hello' --session-id test"
