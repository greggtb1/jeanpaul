#!/bin/bash
# Lance l'app Job Apply (serveur local + dashboard) sur http://127.0.0.1:7433/
cd "$(dirname "$0")" || exit 1
if [ ! -d venv ]; then
  python3 -m venv venv
  ./venv/bin/pip install -r requirements.txt
  ./venv/bin/python -m playwright install chromium
fi
( sleep 2; open "http://127.0.0.1:7433/" ) &
./venv/bin/python state_server.py
