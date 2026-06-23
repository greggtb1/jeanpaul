# BLOW MY JOB Agent (desktop)

Application Tauri pour l'auto-apply local (Chromium visible sur la machine de l'utilisateur).

## Prérequis

- Node 22+
- Rust (via [rustup](https://rustup.rs))
- Python 3.11 + venv dans `engine/venv` (pour build sidecar)

## Dev local

```bash
# Terminal 1 — Next.js
cd /Users/gregoirelinee/dev/aiapply
npm run dev

# Terminal 2 — Agent Tauri
cd desktop
npm install
export VITE_API_ORIGIN=http://localhost:3000
npm run tauri:dev
```

En dev, si le sidecar PyInstaller n'est pas buildé, l'agent utilise `engine/venv/bin/python` en fallback.

## Build sidecar Python

```bash
bash desktop/scripts/build-sidecar.sh
```

Produit `desktop/src-tauri/bin/blowmyjob-engine-<target-triple>`.

## Build installateur

```bash
cd desktop
export VITE_API_ORIGIN=https://blowmyjob.fr
npm run tauri:build
```

## Build Windows

Le plus simple : lance le workflow GitHub Actions **Build BLOW MY JOB Agent**. Il produit :

- `BLOW-MY-JOB-Agent_x64-setup.exe` pour Windows 10/11
- les `.dmg` macOS

En urgence depuis une machine Windows :

```powershell
powershell -ExecutionPolicy Bypass -File desktop/scripts/build-windows.ps1
```

Le script copie l'installateur final ici :

```text
public/downloads/agent/BLOW-MY-JOB-Agent_x64-setup.exe
```

## Deep link

Protocole : `blowmyjob://autoapply?token=<uuid>`

Généré par `POST /api/pipeline` (mode `autoapply`), consommé par `POST /api/agent/claim`.

## Variables serveur requises

- `SUPABASE_JWT_SECRET` — pour mint le JWT user côté claim
- `AGENT_JWT_SECRET` — optionnel, JWT agent court
- `ANTHROPIC_API_KEY` — transmis à l'agent après claim (abonné actif)
