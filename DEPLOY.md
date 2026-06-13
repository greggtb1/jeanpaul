# Déploiement JEAN PAUL → Hostinger

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
2. **Ne touche pas** à `~/jeanpaul/engine/venv/` sur le serveur (venv Linux)

---

## 3. SSH — fix obligatoire après chaque deploy

```bash
ssh -p 65002 u705793670@82.25.113.153
bash ~/jeanpaul/scripts/fix-hostinger-prod.sh
```

Le script :
- tue les processus Node zombies (évite le 503)
- relie `engine/` vers `nodejs/` (l’app tourne là, pas dans `jeanpaul/`)
- corrige le `.env` si besoin

**Vérifier la clé Anthropic :**
```bash
ls ~/jeanpaul/engine/.env
```
Si absent, depuis ton Mac :
```bash
scp -P 65002 engine/.env u705793670@82.25.113.153:jeanpaul/engine/.env
```

---

## 4. Restart — UNE SEULE FOIS

hPanel → Websites → jeanpauljob.com → **Node.js → Restart**

Attends 2 min. **Ne clique pas 5 fois** → 503 garanti.

---

## 5. Test

- https://jeanpauljob.com → login OK
- Dashboard → « Lancer la recherche » → terminal avance

---

## Récap 30 secondes

```
Mac:     npm run build && bash scripts/make-deploy-zip.sh
hPanel:  upload deploy.zip
SSH:     bash ~/jeanpaul/scripts/fix-hostinger-prod.sh
hPanel:  Restart (1×)
```

---

## Si ça casse

| Symptôme | Cause | Fix |
|----------|-------|-----|
| 503 Service Unavailable | Trop de Restart / serveur saturé | SSH → script fix → Restart **1×** |
| Moteur indisponible | `engine/` absent de `nodejs/` | `bash ~/jeanpaul/scripts/fix-hostinger-prod.sh` |
| Login cassé (URL Supabase bizarre) | `APP_ROOT` collé à l’URL dans `.env` | Le script fix le corrige |
| Clé Anthropic manquante | `engine/.env` absent | `scp engine/.env` (voir §3) |
| Moteur cassé après deploy | Zip a écrasé le venv Mac | Réinstaller venv Linux (§6) |

---

## 6. Réinstaller le venv Python (rare)

Seulement si le venv Linux a été supprimé/écrasé :

```bash
cd ~/jeanpaul/engine
rm -rf venv
/opt/alt/python311/bin/python3.11 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt
./venv/bin/playwright install chromium
```

Puis refaire §3 + Restart 1×.
