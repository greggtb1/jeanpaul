# Déploiement BLOW MY JOB → Hostinger

## 1. Sur ton Mac (avant upload)

```bash
cd /Users/gregoirelinee/dev/aiapply
npm run build
bash scripts/make-deploy-zip.sh
```

→ Crée `deploy.zip` (sans `node_modules/`, sans `engine/venv/`, sans secrets).

**Ne jamais mettre dans le zip :** `node_modules/`, `engine/venv/`, `engine/.env`, `.env.local`

---

## 2. Hostinger — upload

1. hPanel → déploie `deploy.zip` dans l’app
2. **Ne touche pas** à `~/blowmyjob/engine/venv/` sur le serveur (venv Linux)

---

## 3. SSH — fix obligatoire après chaque deploy

```bash
ssh -p 65002 u705793670@82.25.113.153
bash ~/blowmyjob/scripts/fix-hostinger-prod.sh
```
ls ~/blowmyjob/engine/run_for_user.py && bash ~/domains/blowmyjob.fr/public_html/.builds/last-source/scripts/fix-hostinger-prod.sh


Le script :
- tue les processus Node zombies (évite le 503)
- relie `engine/` vers `nodejs/` (l’app tourne là, pas dans `blowmyjob/`)
- corrige le `.env` si besoin

**Vérifier la clé Anthropic :**
```bash
ls ~/blowmyjob/engine/.env
```
Si absent, depuis ton Mac :
```bash
scp -P 65002 engine/.env u705793670@82.25.113.153:blowmyjob/engine/.env
```

---

## 4. Restart — UNE SEULE FOIS

hPanel → Websites → blowmyjob.fr → **Node.js → Restart**

Attends 2 min. **Ne clique pas 5 fois** → 503 garanti.

---

## 5. Test

- https://blowmyjob.fr → login OK
- Dashboard → « Lancer la recherche » → terminal avance

---

## Récap 30 secondes

```
Mac:     npm run build && bash scripts/make-deploy-zip.sh
hPanel:  upload deploy.zip
SSH:     bash ~/blowmyjob/scripts/fix-hostinger-prod.sh
hPanel:  Restart (1×)
```

---

## Si ça casse

| Symptôme | Cause | Fix |
|----------|-------|-----|
| 503 Service Unavailable | Trop de Restart / serveur saturé | SSH → script fix → Restart **1×** |
| Moteur indisponible | `engine/` absent de `nodejs/` | `bash ~/blowmyjob/scripts/fix-hostinger-prod.sh` |
| Login cassé (URL Supabase bizarre) | `APP_ROOT` collé à l’URL dans `.env` | Le script fix le corrige |
| Clé Anthropic manquante | `engine/.env` absent | `scp engine/.env` (voir §3) |
| Moteur cassé après deploy | Zip a écrasé le venv Mac | Réinstaller venv Linux (§6) |

---

## 6. Réinstaller le venv Python (rare)

Seulement si le venv Linux a été supprimé/écrasé :

```bash
cd ~/blowmyjob/engine
rm -rf venv
/opt/alt/python311/bin/python3.11 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt
./venv/bin/playwright install chromium
```

Puis refaire §3 + Restart 1×.

---

## 7. Agent desktop (auto-apply)

L'auto-apply ne tourne **plus sur le serveur** Hostinger (pas d'écran). Il passe par l'agent Tauri installé chez l'utilisateur.

### Variables `.env` serveur (en plus des existantes)

```
SUPABASE_JWT_SECRET=...     # Supabase → Settings → API → JWT Secret
AGENT_JWT_SECRET=...         # optionnel (sinon réutilise SUPABASE_JWT_SECRET)
ANTHROPIC_API_KEY=...        # déjà requis pour le moteur
NEXT_PUBLIC_AGENT_RELEASE_URL=https://blowmyjob.fr/downloads/agent
```

### Migration Supabase

Appliquer `supabase/migrations/20260613120000_pipeline_runs_update_policy.sql` (policy UPDATE sur `pipeline_runs` pour les logs agent).

### Build agent (Mac + Windows)

```bash
cd desktop
npm install
bash scripts/build-sidecar.sh
VITE_API_ORIGIN=https://blowmyjob.fr npm run tauri:build
```

CI : tag `agent-v*` → workflow `.github/workflows/agent-desktop.yml`.

### Test prod

1. Déployer le web (§1–4)
2. Installer l'agent depuis `/download`
3. Dashboard → sélectionner offres → Postuler → deep link `blowmyjob://` → Chromium local
