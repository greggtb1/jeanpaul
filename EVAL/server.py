#!/usr/bin/env python3
"""
Petit serveur local pour l'interface d'évaluation auto-apply.

Aucune dépendance externe (bibliothèque standard uniquement).
Lance l'éval (engine/eval_autoapply.py) en arrière-plan et expose le scorecard
+ les captures d'écran à l'interface web (EVAL/index.html).

Démarrage simple : double-clic sur EVAL/start.command
(ou : python3 EVAL/server.py)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import webbrowser
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

EVAL_DIR = Path(__file__).resolve().parent
REPO = EVAL_DIR.parent
ENGINE = REPO / "engine"
SCRIPT = ENGINE / "eval_autoapply.py"
RUNS_DIR = EVAL_DIR / "runs"
RUNS_DIR.mkdir(exist_ok=True)

PORT = int(os.environ.get("EVAL_PORT", "8765"))

# Python du venv moteur (a Playwright + Anthropic). Fallback : python courant.
VENV_PY = ENGINE / "venv" / "bin" / "python"
PY = str(VENV_PY) if VENV_PY.exists() else sys.executable

JOBS: dict[str, dict] = {}


def _new_job(urls: list[str], cv_path: str, letter: str) -> dict:
    job_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir = RUNS_DIR / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    config = {
        "cv_path": cv_path or "",
        "letter": letter or "",
        "targets": [{"url": u} for u in urls],
    }
    config_path = out_dir / "config.json"
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")

    log_path = out_dir / "log.txt"
    log_f = open(log_path, "w", encoding="utf-8")
    proc = subprocess.Popen(
        [PY, str(SCRIPT), "--config", str(config_path), "--out", str(out_dir)],
        cwd=str(ENGINE),
        stdout=log_f,
        stderr=subprocess.STDOUT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    job = {"id": job_id, "out_dir": out_dir, "log": log_path, "proc": proc, "total": len(urls)}
    JOBS[job_id] = job
    return job


def _job_status(job_id: str) -> dict:
    job = JOBS.get(job_id)
    out_dir = RUNS_DIR / job_id
    if not job and not out_dir.exists():
        return {"error": "job inconnu"}

    proc = job["proc"] if job else None
    running = proc is not None and proc.poll() is None

    log = ""
    log_path = out_dir / "log.txt"
    if log_path.exists():
        log = log_path.read_text(encoding="utf-8", errors="replace")[-8000:]

    # Résultats live : un trace.json par cas
    results = []
    for case in sorted(out_dir.glob("*/trace.json")):
        try:
            results.append(json.loads(case.read_text(encoding="utf-8")))
        except Exception:
            pass

    total = job["total"] if job else len(results)
    return {
        "id": job_id,
        "running": running,
        "done": not running,
        "total": total,
        "completed": len(results),
        "results": results,
        "log": log,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # silencieux

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str):
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path

        if route in ("/", "/index.html"):
            idx = EVAL_DIR / "index.html"
            if idx.exists():
                self._send_file(idx, "text/html; charset=utf-8")
            else:
                self._send_json({"error": "index.html manquant"}, 404)
            return

        if route == "/api/status":
            qs = parse_qs(parsed.query)
            job_id = (qs.get("id") or [""])[0]
            self._send_json(_job_status(job_id))
            return

        if route == "/api/file":
            qs = parse_qs(parsed.query)
            job_id = (qs.get("id") or [""])[0]
            rel = (qs.get("path") or [""])[0]
            base = (RUNS_DIR / job_id).resolve()
            target = (base / rel).resolve()
            # Anti-traversal : reste dans le dossier du job
            if not str(target).startswith(str(base)) or not target.exists():
                self._send_json({"error": "fichier introuvable"}, 404)
                return
            ext = target.suffix.lower()
            ct = {".png": "image/png", ".jpg": "image/jpeg",
                  ".json": "application/json", ".txt": "text/plain; charset=utf-8"}.get(ext, "application/octet-stream")
            self._send_file(target, ct)
            return

        self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/run":
            self._send_json({"error": "not found"}, 404)
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            payload = {}

        raw_urls = payload.get("urls", "")
        urls = [u.strip() for u in raw_urls.replace(",", "\n").splitlines() if u.strip().startswith("http")]
        if not urls:
            self._send_json({"error": "Aucune URL valide (doit commencer par http)."}, 400)
            return

        job = _new_job(urls, payload.get("cv_path", ""), payload.get("letter", ""))
        self._send_json({"id": job["id"], "total": job["total"]})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://localhost:{PORT}/"
    print("\n================ ÉVAL AUTO-APPLY ================")
    print(f"  Interface : {url}")
    print(f"  Python éval : {PY}")
    print("  (Garde cette fenêtre ouverte. Ferme-la pour arrêter.)")
    print("=================================================\n")
    if not os.environ.get("EVAL_NO_BROWSER"):
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArrêt.")
        server.shutdown()


if __name__ == "__main__":
    main()
