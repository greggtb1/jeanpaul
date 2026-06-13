#!/usr/bin/env bash
# Diagnostic rapide — à lancer sur le serveur Hostinger après SSH.
set -euo pipefail

echo "=== JEAN PAUL — diagnostic moteur ==="
echo "Dossier courant : $(pwd)"
echo ""

if [[ -f package.json ]]; then
  echo "✓ package.json trouvé (racine app Next.js)"
else
  echo "✗ package.json absent — vous n'êtes peut-être pas dans le bon dossier."
  echo "  Cherchez avec : find ~ -name package.json 2>/dev/null | head -5"
fi

if [[ -f engine/run_for_user.py ]]; then
  echo "✓ engine/run_for_user.py présent"
else
  echo "✗ engine/run_for_user.py ABSENT — redéployez tout le projet (pas seulement .next/)"
fi

if [[ -x engine/venv/bin/python ]]; then
  echo "✓ engine/venv/bin/python présent"
  engine/venv/bin/python --version
else
  echo "✗ venv Python absent — lancez : bash scripts/setup-engine-prod.sh"
fi

if command -v python3 >/dev/null 2>&1; then
  echo "✓ python3 système : $(python3 --version 2>&1)"
else
  echo "✗ python3 absent sur ce serveur"
fi

if [[ -f .env ]] || [[ -f .env.local ]] || [[ -f .env.production ]]; then
  echo "✓ fichier .env trouvé"
  for f in .env .env.local .env.production; do
    [[ -f "$f" ]] && grep -q SUPABASE_SERVICE_ROLE_KEY "$f" && echo "  ✓ SUPABASE_SERVICE_ROLE_KEY dans $f" && break
  done
else
  echo "⚠ aucun .env visible ici (peut être configuré dans hPanel Node.js)"
fi

echo ""
echo "=== fin diagnostic ==="
