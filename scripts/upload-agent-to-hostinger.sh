#!/usr/bin/env bash
# Upload les installateurs agent vers Hostinger (hors deploy.zip — fichiers lourds).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/public/downloads/agent"
SSH_HOST="${AGENT_SSH_HOST:-u705793670@82.25.113.153}"
SSH_PORT="${AGENT_SSH_PORT:-65002}"
REMOTE_BASE="${AGENT_REMOTE_BASE:-~/domains/blowmyjob.fr/public_html/nodejs/public/downloads/agent}"

if [[ ! -d "$SRC" ]]; then
  echo "Dossier introuvable: $SRC" >&2
  exit 1
fi

shopt -s nullglob
files=("$SRC"/*.dmg "$SRC"/*.exe)
if [[ ${#files[@]} -eq 0 ]]; then
  echo "Aucun .dmg/.exe dans $SRC — build l'agent d'abord." >&2
  exit 1
fi

echo "==> Création dossier distant"
ssh -p "$SSH_PORT" "$SSH_HOST" "mkdir -p $REMOTE_BASE"

for f in "${files[@]}"; do
  echo "==> Upload $(basename "$f")"
  scp -P "$SSH_PORT" "$f" "$SSH_HOST:$REMOTE_BASE/"
done

echo "OK → https://blowmyjob.fr/downloads/agent/"
