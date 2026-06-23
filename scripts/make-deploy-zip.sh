#!/usr/bin/env bash
# Crée un zip de déploiement SANS engine/venv (Mac) ni node_modules.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/deploy.zip}"

cd "$ROOT"
zip -r "$OUT" . \
  -x "node_modules/*" \
  -x "moteur/*" \
  -x "desktop/*" \
  -x "EVAL/*" \
  -x "engine/venv/*" \
  -x "engine/applications/*" \
  -x ".git/*" \
  -x ".next/cache/*" \
  -x "*.zip" \
  -x "__MACOSX/*" \
  -x ".DS_Store" \
  -x ".env.local" \
  -x ".env.production" \
  -x "hostinger.env" \
  -x "public/downloads/agent/JEAN-PAUL-*"

echo "OK → $OUT"
echo "Après upload : réinstallez le venv Linux en SSH si engine/venv a été écrasé."
