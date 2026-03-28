#!/bin/bash
set -e

NETWORK_NAME="llmserver-ai-network"
SUBNET="172.28.0.0/16"

echo "Creating unified AI network: $NETWORK_NAME"

if docker network inspect "$NETWORK_NAME" &> /dev/null; then
    echo "✓ Network already exists"
else
    docker network create \
        --driver bridge \
        --subnet "$SUBNET" \
        --opt com.docker.network.bridge.name=br-llmserver \
        "$NETWORK_NAME"
    echo "✓ Created network $NETWORK_NAME ($SUBNET)"
fi

echo ""
echo "Services can now connect using hostnames:"
echo "  - llama-server-orchestrator:8080"
echo "  - llama-server-worker:8080"
echo "  - litellm-proxy:4000"
echo "  - openshell-gateway:30051"
