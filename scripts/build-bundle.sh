#!/bin/bash
# Build combined AgentOS bundle for easy injection

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INJECTOR_DIR="$PROJECT_DIR/.windsurf/injector"
DIST_DIR="$PROJECT_DIR/dist"

echo "Building AgentOS combined bundle..."

# Create dist directory
mkdir -p "$DIST_DIR"

# Combine bundles
cat > "$DIST_DIR/agentOS-combined.js" << 'HEADER'
/**
 * AgentOS Combined Bundle
 * One-paste injection for DevTools Console
 *
 * Built: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
 *
 * Usage:
 *   1. Open DevTools Console (Cmd+Option+I)
 *   2. Paste this entire file
 *   3. Press Enter
 *
 * Keyboard Shortcuts:
 *   Cmd+Shift+I - Spawn new agent
 *   Cmd+Shift+K - Toggle agent panel
 *   Cmd+Shift+L - List agents (console)
 */

HEADER

# Append AgentOS bundle
echo "// ========== AgentOS Core ==========" >> "$DIST_DIR/agentOS-combined.js"
cat "$INJECTOR_DIR/agentOS-bundle.js" >> "$DIST_DIR/agentOS-combined.js"
echo "" >> "$DIST_DIR/agentOS-combined.js"

# Append Workflow Engine bundle
echo "// ========== Workflow Engine ==========" >> "$DIST_DIR/agentOS-combined.js"
cat "$INJECTOR_DIR/workflow-engine-bundle.js" >> "$DIST_DIR/agentOS-combined.js"

# Get file size
SIZE=$(wc -c < "$DIST_DIR/agentOS-combined.js" | tr -d ' ')
SIZE_KB=$((SIZE / 1024))

echo "Done! Created: dist/agentOS-combined.js (${SIZE_KB}KB)"
echo ""
echo "To use:"
echo "  1. Open Windsurf DevTools Console (Cmd+Option+I)"
echo "  2. Copy contents of dist/agentOS-combined.js"
echo "  3. Paste and press Enter"
