#!/usr/bin/env bash
set -euo pipefail

# FlowTask Global Installation Script
# Automates global installation and verification.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PACKAGE_NAME="flowtask"

echo "========================================"
echo " FlowTask Global Installation"
echo "========================================"
echo ""

# ── Check prerequisites ──────────────────────────────────────────────────────

echo "🔍 Checking prerequisites..."

# Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js is not installed. Install Node.js 22+ from https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node --version)
NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ Node.js 22+ required (found $NODE_VERSION)"
  exit 1
fi
echo "  ✓ Node.js $NODE_VERSION"

# Package manager detection
PM=""
if command -v pnpm &>/dev/null; then
  PM="pnpm"
elif command -v npm &>/dev/null; then
  PM="npm"
elif command -v yarn &>/dev/null; then
  PM="yarn"
else
  echo "❌ No package manager found (npm, pnpm, or yarn required)"
  exit 1
fi
echo "  ✓ Package manager: $PM ($($PM --version))"

echo ""

# ── Build the project ────────────────────────────────────────────────────────

echo "📦 Building project..."
cd "$PROJECT_DIR"
$PM install --frozen-lockfile 2>/dev/null || $PM install
$PM run build
echo "  ✓ Build complete"
echo ""

# ── Install globally ─────────────────────────────────────────────────────────

echo "🌍 Installing $PACKAGE_NAME globally via $PM..."

case "$PM" in
  pnpm)
    PNPM_HOME="${PNPM_HOME:-$HOME/Library/pnpm}"
    mkdir -p "$PNPM_HOME"
    echo "  Using global bin directory: $PNPM_HOME"
    PATH="$PNPM_HOME:$PATH" PNPM_HOME="$PNPM_HOME" pnpm add -g "$PROJECT_DIR"
    ;;
  npm)
    npm install -g "$PROJECT_DIR"
    ;;
  yarn)
    yarn global add "$PROJECT_DIR"
    ;;
esac

echo "  ✓ Global install complete"
echo ""

# ── Verify installation ──────────────────────────────────────────────────────

echo "✅ Verifying installation..."

if command -v flowtask &>/dev/null; then
  FLOWTASK_VERSION=$(flowtask --version 2>/dev/null || echo "version check failed")
  echo "  ✓ flowtask found at $(command -v flowtask)"
  echo "  ✓ flowtask --version: $FLOWTASK_VERSION"
else
  echo "  ⚠ flowtask command not found in PATH"
  echo "  Attempting fallback check..."

  # Try via npx or direct node
  if node -e "require('$PACKAGE_NAME')" 2>/dev/null; then
    echo "  ✓ Package resolves via Node.js require()"
  else
    echo "  ⚠ Package not found via require() either"
  fi
fi

echo ""
echo "========================================"
echo " Installation complete!"
echo ""
echo " Next steps:"
echo "   flowtask init --name \"My Project\" --mode development"
echo "   flowtask doctor"
echo "   flowtask run \"your prompt here\""
echo "========================================"
