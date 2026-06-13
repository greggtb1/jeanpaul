#!/usr/bin/env bash
# Post-déploiement Hostinger — à lancer en SSH après chaque deploy.
set -euo pipefail

ENGINE_SRC="${ENGINE_SRC:-$HOME/jeanpaul/engine}"
NODEJS="${NODEJS:-$HOME/domains/jeanpauljob.com/nodejs}"
ENV_FILE="${ENV_FILE:-$HOME/domains/jeanpauljob.com/public_html/.builds/config/.env}"

echo "=== JEAN PAUL — fix post-deploy ==="

# 1. Tuer les processus Node zombies (évite le 503)
BEFORE=$(pgrep -c -f 'next-server' 2>/dev/null || echo 0)
if [[ "$BEFORE" -gt 1 ]]; then
  echo "Arrêt de $BEFORE processus next-server…"
  pkill -u "$(whoami)" -f 'next-server' 2>/dev/null || true
  sleep 2
  pkill -9 -u "$(whoami)" -f 'next-server' 2>/dev/null || true
  sleep 1
fi
echo "Processus next-server : $(pgrep -c -f 'next-server' 2>/dev/null || echo 0)"

# 2. Corriger .env si APP_ROOT collé à l'URL Supabase
if [[ -f "$ENV_FILE" ]]; then
  if grep -q "supabase.co'APP_ROOT" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|supabase.co'APP_ROOT=|supabase.co'\nAPP_ROOT=|" "$ENV_FILE"
    echo "Corrigé : NEXT_PUBLIC_SUPABASE_URL dans .env"
  fi
  if grep -q "supabase.coAPP_ROOT" "$ENV_FILE" 2>/dev/null; then
    sed -i 's|supabase.coAPP_ROOT=|supabase.co\nAPP_ROOT=|' "$ENV_FILE"
    echo "Corrigé : NEXT_PUBLIC_SUPABASE_URL (sans quote)"
  fi
  # Ajouter ENGINE_* sur des lignes séparées (jamais concaténer)
  for VAR in \
    "APP_ROOT=$HOME/jeanpaul" \
    "ENGINE_DIR=$ENGINE_SRC" \
    "ENGINE_PYTHON=$ENGINE_SRC/venv/bin/python"; do
    KEY="${VAR%%=*}"
    if ! grep -q "^${KEY}=" "$ENV_FILE" 2>/dev/null; then
      printf '\n%s\n' "$VAR" >> "$ENV_FILE"
      echo "Ajouté : $KEY"
    fi
  done
fi

# 3. Lier engine/ vers nodejs/ (dossier runtime Hostinger)
if [[ ! -f "$ENGINE_SRC/run_for_user.py" ]]; then
  echo "ERREUR : $ENGINE_SRC/run_for_user.py introuvable"
  exit 1
fi

link_engine() {
  local target="$1"
  local dir
  dir="$(dirname "$target")"
  [[ -d "$dir" ]] || return 0
  ln -sfn "$ENGINE_SRC" "$target"
  echo "Lié : $target"
}

link_engine "$HOME/domains/jeanpauljob.com/public_html/engine"
link_engine "$HOME/domains/jeanpauljob.com/public_html/.builds/last-source/engine"
link_engine "$NODEJS/engine"

echo ""
if [[ -x "$NODEJS/engine/venv/bin/python" ]]; then
  echo "OK — moteur prêt"
  "$NODEJS/engine/venv/bin/python" --version
else
  echo "ATTENTION : venv absent — réinstallez avec :"
  echo "  cd $ENGINE_SRC && /opt/alt/python311/bin/python3.11 -m venv venv && ./venv/bin/pip install -r requirements.txt && ./venv/bin/playwright install chromium"
fi

if [[ -f "$ENGINE_SRC/.env" ]]; then
  echo "OK — engine/.env présent (clé Anthropic)"
else
  echo "ATTENTION : $ENGINE_SRC/.env absent — la recherche échouera sans ANTHROPIC_API_KEY"
fi

echo ""
echo ">>> Maintenant : hPanel → Node.js → Restart (UNE SEULE FOIS)"
