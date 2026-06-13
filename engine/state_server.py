"""
Mini serveur HTTP local (lib standard Python, zéro framework) — rôles :
  1. Sert l'app (app.html = barre de contrôle + dashboard.html en iframe)
  2. Expose les offres depuis Supabase (GET /jobs)
  3. Lance scrape / apply via le CLI dans un thread (POST /scrape, /apply)
     et streame les logs (GET /run-status)
  4. Persiste l'état du dashboard dans Supabase (/state, /blacklist)

Ouvre http://127.0.0.1:7433/ dans le navigateur.
Lance : python state_server.py
"""
import json, threading, sys, os, subprocess, mimetypes
from collections import deque
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

BASE_DIR = Path(__file__).parent
PORT     = 7433
PYTHON   = sys.executable  # le python du venv qui lance ce serveur
MAIN     = str(BASE_DIR / "main.py")

# ── État d'exécution (scrape / apply) ────────────────────────────────────────
RUN = {"running": False, "label": "", "log": deque(maxlen=400)}
_run_lock = threading.Lock()


def _store():
    sys.path.insert(0, str(BASE_DIR))
    import store
    return store


def _run_cli(steps, label):
    """Exécute une suite de commandes CLI dans un thread, logge la sortie."""
    with _run_lock:
        if RUN["running"]:
            return
        RUN["running"] = True
        RUN["label"] = label
        RUN["log"].clear()

    def worker():
        try:
            for args in steps:
                RUN["log"].append(f"$ main.py {' '.join(args)}")
                proc = subprocess.Popen(
                    [PYTHON, "-u", MAIN, *args],
                    cwd=str(BASE_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    env={**os.environ},
                )
                for line in proc.stdout:
                    RUN["log"].append(line.rstrip("\n"))
                proc.wait()
                if proc.returncode != 0:
                    RUN["log"].append(f"[!] échec (code {proc.returncode}), arrêt.")
                    break
            RUN["log"].append("✅ Terminé.")
        except Exception as e:
            RUN["log"].append(f"[!] Erreur: {e}")
        finally:
            RUN["running"] = False

    threading.Thread(target=worker, daemon=True).start()


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, path: Path):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_GET(self):
        path = unquote(self.path.split("?")[0])

        if path == "/ping":
            self.send_response(200); self._cors(); self.end_headers()
            self.wfile.write(b"ok"); return

        # ── App (barre de contrôle) ──────────────────────────────────────────
        if path == "/":
            app = BASE_DIR / "app.html"
            dash = BASE_DIR / "dashboard.html"
            if app.exists():
                self._html(app); return
            if dash.exists():
                self._html(dash); return
            self.send_response(404); self.end_headers()
            self.wfile.write(b"app.html introuvable"); return

        if path == "/dashboard.html":
            f = BASE_DIR / "dashboard.html"
            if f.exists(): self._html(f); return
            self.send_response(404); self.end_headers()
            self.wfile.write(b"dashboard.html introuvable - lance: python main.py dashboard"); return

        # ── Données ──────────────────────────────────────────────────────────
        if path == "/jobs":
            try:
                self._json({"jobs": _store().load_jobs()})
            except Exception as e:
                self._json({"error": str(e)}, 500)
            return

        if path == "/run-status":
            self._json({"running": RUN["running"], "label": RUN["label"],
                        "log": list(RUN["log"])})
            return

        if path == "/state":
            try:
                self._json(_store().load_state())
            except Exception as e:
                self._json({"error": str(e)}, 500)
            return

        # ── Fichiers statiques (applications/, CVs, lettres…) ────────────────
        try:
            rel = path.lstrip("/")
            file_path = (BASE_DIR / rel).resolve()
            file_path.relative_to(BASE_DIR.resolve())
            if file_path.exists() and file_path.is_file():
                body = file_path.read_bytes()
                mime, _ = mimetypes.guess_type(str(file_path))
                self.send_response(200)
                self.send_header("Content-Type", mime or "application/octet-stream")
                self.send_header("Content-Length", str(len(body)))
                if any(str(file_path).lower().endswith(ext) for ext in (".pdf", ".docx", ".txt")):
                    self.send_header("Content-Disposition", f'attachment; filename="{file_path.name}"')
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_response(404); self.end_headers()
        except Exception:
            self.send_response(403); self.end_headers()

    def _read_body(self):
        n = int(self.headers.get("Content-Length", 0) or 0)
        if n == 0:
            return {}
        try:
            return json.loads(self.rfile.read(n))
        except Exception:
            return {}

    def do_POST(self):
        path = self.path.split("?")[0]

        if path == "/scrape":
            _run_cli([["scrape"], ["analyze"], ["dashboard", "--no-open"]], "Scraping + analyse")
            self._json({"started": True}); return

        if path == "/apply":
            data = self._read_body()
            args = ["apply"]
            if data.get("ids"):
                args += ["--ids", str(data["ids"])]
            elif data.get("all"):
                args += ["--all"]
            else:
                args += ["--min-score", str(data.get("min_score", 6))]
            _run_cli([args, ["dashboard", "--no-open"]], "Génération CV + lettres")
            self._json({"started": True}); return

        if path == "/run-dashboard":
            _run_cli([["dashboard", "--no-open"]], "Régénération dashboard")
            self._json({"started": True}); return

        if path == "/blacklist":
            data = self._read_body()
            url = (data.get("url") or "").strip()
            try:
                if url:
                    _store().blacklist_url(url)
                self.send_response(200); self._cors(); self.end_headers()
                self.wfile.write(b"ok")
            except Exception as e:
                self.send_response(500); self.end_headers()
                self.wfile.write(str(e).encode())
            return

        if path == "/state":
            data = self._read_body()
            try:
                _store().save_state(data)
                self.send_response(200); self._cors(); self.end_headers()
                self.wfile.write(b"ok")
            except Exception as e:
                self.send_response(500); self.end_headers()
                self.wfile.write(str(e).encode())
            return

        self.send_response(404); self.end_headers()


def start(daemon=True):
    try:
        srv = HTTPServer(("127.0.0.1", PORT), _Handler)
        if daemon:
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        else:
            print(f"OK port {PORT}", flush=True)
            srv.serve_forever()
    except OSError as e:
        if not daemon:
            print(f"OSError: {e}", file=sys.stderr, flush=True)
            sys.exit(1)


if __name__ == "__main__":
    print(f"state_server starting on port {PORT}", flush=True)
    start(daemon=False)
