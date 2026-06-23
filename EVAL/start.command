#!/usr/bin/env bash
# Double-clique ce fichier pour ouvrir l'interface d'évaluation auto-apply.
cd "$(dirname "$0")"

PY="../engine/venv/bin/python"
[ -x "$PY" ] || PY="python3"

echo "Lancement de l'interface d'éval…"
exec "$PY" server.py
