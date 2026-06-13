#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/engine"

if [[ ! -f "$ENGINE/run_for_user.py" ]]; then
  echo "Erreur : engine/run_for_user.py introuvable."
  echo "Déployez tout le repo (dossier engine/ inclus), pas seulement .next/"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Erreur : python3 absent. Activez Python dans hPanel ou passez sur un VPS."
  exit 1
fi

cd "$ENGINE"
python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

echo "Installation Chromium Playwright…"
if ./venv/bin/playwright install chromium; then
  ./venv/bin/playwright install-deps chromium 2>/dev/null || true
else
  echo "Attention : Playwright Chromium a échoué. Vérifiez les droits du serveur."
  exit 1
fi

echo ""
echo "OK — moteur prêt :"
echo "  $ENGINE/venv/bin/python"
echo ""
echo "Vérifiez que .env contient SUPABASE_SERVICE_ROLE_KEY puis redémarrez l'app Node."
