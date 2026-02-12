#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "  NYC Subway Transit Display — Installer"
echo "  ───────────────────────────────────────"
echo ""

# ── Node.js check / install ────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "  Node.js not found. Installing via NodeSource (v20 LTS)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "  node $(node --version)   npm $(npm --version)"
echo ""

# ── Backend deps ───────────────────────────────────────────
echo "  Installing backend dependencies..."
cd "$ROOT/backend"
npm install --omit=dev
echo ""

# ── Frontend deps + build ──────────────────────────────────
echo "  Installing frontend dependencies..."
cd "$ROOT/frontend"
npm install
echo "  Building frontend..."
npm run build
echo ""

# ── Optional: download station names ───────────────────────
echo "  Downloading MTA station names (optional, for destination display)..."
cd "$ROOT/backend"
npm run download-stops || echo "  (skipped — you can run this later)"
echo ""

echo "  ✓ Installation complete!"
echo ""
echo "  Quick start (development):"
echo "    Terminal 1:  cd $ROOT/backend  && npm run dev"
echo "    Terminal 2:  cd $ROOT/frontend && npm run dev"
echo "    Open http://localhost:5173"
echo ""
echo "  Production (single server):"
echo "    cd $ROOT/backend && NODE_ENV=production node server.js"
echo "    Open http://localhost:3001"
echo ""
echo "  Configure your station:  edit $ROOT/backend/config.js"
echo ""
