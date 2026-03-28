#!/bin/bash
# Backup and restore Terminia workspace files from/to the NemoClaw sandbox.
# Usage:
#   ./scripts/backup-workspace.sh backup [sandbox-name]
#   ./scripts/backup-workspace.sh restore [sandbox-name] [timestamp]
#
# Ref: https://docs.nvidia.com/nemoclaw/latest/workspace/backup-restore.html
set -e

SANDBOX="${2:-terminia}"
BACKUP_BASE="$HOME/.nemoclaw/backups"
WORKSPACE_PATH="/sandbox/.openclaw/workspace"
WORKSPACE_FILES="SOUL.md USER.md IDENTITY.md AGENTS.md MEMORY.md"

case "${1:-}" in
  backup)
    TIMESTAMP=$(date +%Y%m%d-%H%M%S)
    BACKUP_DIR="$BACKUP_BASE/$TIMESTAMP"
    mkdir -p "$BACKUP_DIR"
    
    echo "Backing up workspace from sandbox '$SANDBOX'..."
    
    count=0
    for f in $WORKSPACE_FILES; do
      openshell sandbox download "$SANDBOX" "$WORKSPACE_PATH/$f" "$BACKUP_DIR/" 2>/dev/null && \
        ((count++)) || echo "  ⚠ $f not found (skipped)"
    done
    
    # Backup memory directory
    openshell sandbox download "$SANDBOX" "$WORKSPACE_PATH/memory/" "$BACKUP_DIR/memory/" 2>/dev/null && \
      ((count++)) || echo "  ⚠ memory/ not found (skipped)"
    
    # Also backup skills if requested
    if [ "${3:-}" = "--with-skills" ]; then
      openshell sandbox download "$SANDBOX" "/sandbox/.openclaw/skills/" "$BACKUP_DIR/skills/" 2>/dev/null && \
        ((count++)) || echo "  ⚠ skills/ not found (skipped)"
    fi
    
    echo "Backup saved to $BACKUP_DIR/ ($count items)"
    ;;
    
  restore)
    if [ -n "${3:-}" ]; then
      BACKUP_DIR="$BACKUP_BASE/$3"
    else
      # Find most recent backup
      BACKUP_DIR=$(ls -d "$BACKUP_BASE"/*/ 2>/dev/null | sort -r | head -1)
    fi
    
    if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
      echo "No backup found. Available backups:"
      ls "$BACKUP_BASE" 2>/dev/null || echo "  (none)"
      exit 1
    fi
    
    echo "Restoring workspace to sandbox '$SANDBOX' from $BACKUP_DIR..."
    
    for f in $WORKSPACE_FILES; do
      if [ -f "$BACKUP_DIR/$f" ]; then
        openshell sandbox upload "$SANDBOX" "$BACKUP_DIR/$f" "$WORKSPACE_PATH/" && \
          echo "  ✓ $f" || echo "  ✗ $f failed"
      fi
    done
    
    if [ -d "$BACKUP_DIR/memory" ]; then
      openshell sandbox upload "$SANDBOX" "$BACKUP_DIR/memory/" "$WORKSPACE_PATH/memory/" && \
        echo "  ✓ memory/" || echo "  ✗ memory/ failed"
    fi
    
    echo "Restore complete."
    ;;
    
  list)
    echo "Available backups:"
    ls -1 "$BACKUP_BASE" 2>/dev/null || echo "  (none)"
    ;;
    
  *)
    echo "Usage: $0 {backup|restore|list} [sandbox-name] [timestamp]"
    echo ""
    echo "Commands:"
    echo "  backup [name]              Backup workspace from sandbox"
    echo "  backup [name] --with-skills  Also backup skills"
    echo "  restore [name] [timestamp]  Restore from backup (latest if no timestamp)"
    echo "  list                        List available backups"
    exit 1
    ;;
esac
