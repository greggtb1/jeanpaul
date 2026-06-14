#!/usr/bin/env python3
"""
Lance scrape + analyse pour un utilisateur du dashboard web.
Écrit les logs en temps réel dans pipeline_runs (Supabase).

Usage:
  python run_for_user.py --user-id <uuid> --run-id <uuid>
"""
import argparse
import contextlib
import io
import os
import re
import signal
import subprocess
import sys
from pathlib import Path

BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
sys.path.insert(0, str(BASE))


def _ensure_playwright_browsers_path() -> None:
    """En mode PyInstaller, force un cache navigateur stable (pas _MEIPASS)."""
    if not getattr(sys, "frozen", False):
        return
    if sys.platform == "darwin":
        path = Path.home() / "Library" / "Caches" / "ms-playwright"
    elif sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        path = Path(base) / "ms-playwright"
    else:
        path = Path.home() / ".cache" / "ms-playwright"
    path.mkdir(parents=True, exist_ok=True)
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(path)


_ensure_playwright_browsers_path()

from store import (
    set_user, pipeline_log, pipeline_set_status, pipeline_finish,
    client, upload_app_documents, load_jobs,
    pipeline_register_pid, pipeline_is_cancelled, pipeline_clear_cancel,
    pipeline_cancel, pipeline_request_cancel,
    load_autoapply_selection, clear_autoapply_selection,
    mark_ready_without_cv,
)
from user_profile import clear_profile_cache

APPS_DIR = BASE / "applications"

def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, default)))
    except Exception:
        return default


MIN_SCORE = 6
HUNT_TARGET = _env_int("JA_HUNT_TARGET", 15)  # arrêt dès N offres ≥ MIN_SCORE
MAX_ANALYZED_POOR_FIT = 30  # plafond si objectif non atteint (fit faible)

ANSI = re.compile(r"\x1b\[[0-9;]*m")

_active_proc: subprocess.Popen | None = None


def _terminate_active():
    global _active_proc
    if _active_proc and _active_proc.poll() is None:
        _active_proc.terminate()
        try:
            _active_proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            _active_proc.kill()


def _exit_if_cancelled(run_id: str, user_id: str, urls_before: set | None = None):
    """Finalise proprement un run interrompu (API Stop ou SIGTERM)."""
    _terminate_active()
    st = None
    try:
        from store import pipeline_run_status
        st = pipeline_run_status(run_id)
    except Exception:
        pass
    if st in ("running", "pending"):
        if urls_before is not None:
            new_n = len(_job_urls(user_id) - urls_before)
            pipeline_cancel(
                run_id,
                f"\n🛑 Recherche arrêtée, {new_n} offre(s) récupérée(s) sur ce run.",
            )
        else:
            pipeline_cancel(run_id)
    sys.exit(130)


def _handle_stop(signum, frame):
    run_id = os.environ.get("JA_RUN_ID")
    user_id = os.environ.get("JA_USER_ID")
    if run_id:
        try:
            pipeline_request_cancel(run_id)
        except Exception:
            pass
    _terminate_active()
    if run_id and user_id:
        _exit_if_cancelled(run_id, user_id)
    sys.exit(130)


signal.signal(signal.SIGTERM, _handle_stop)
signal.signal(signal.SIGINT, _handle_stop)


def clean(line: str) -> str:
    return ANSI.sub("", line).rstrip("\n")


def run_main(args: list[str], user_id: str, run_id: str) -> int:
    global _active_proc
    if pipeline_is_cancelled(run_id):
        return 130
    pipeline_log(run_id, f"$ main.py {' '.join(args)}")
    os.environ["JA_USER_ID"] = user_id

    if getattr(sys, "frozen", False):
        return _run_main_inprocess(args, user_id, run_id)

    proc = subprocess.Popen(
        [sys.executable, "-u", str(BASE / "main.py"), *args],
        cwd=str(BASE),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env={**os.environ, "JA_USER_ID": user_id},
    )
    _active_proc = proc
    try:
        for raw in proc.stdout or []:
            if pipeline_is_cancelled(run_id):
                proc.terminate()
                try:
                    proc.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    proc.kill()
                pipeline_log(run_id, "⛔ Script interrompu.")
                return 130
            line = clean(raw)
            if line.strip():
                pipeline_log(run_id, line)
        proc.wait()
        return proc.returncode
    finally:
        _active_proc = None


class _LogCapture(io.TextIOBase):
    """Redirige stdout/stderr vers pipeline_log (mode PyInstaller)."""

    def __init__(self, run_id: str):
        self._run_id = run_id
        self._buf = ""

    def write(self, s: str) -> int:
        if not s:
            return 0
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            text = clean(line)
            if text.strip():
                pipeline_log(self._run_id, text)
        return len(s)

    def flush(self) -> None:
        if self._buf.strip():
            pipeline_log(self._run_id, clean(self._buf))
            self._buf = ""


def _run_main_inprocess(args: list[str], user_id: str, run_id: str) -> int:
    import main as main_module

    old_argv = sys.argv[:]
    old_cwd = os.getcwd()
    try:
        os.chdir(BASE)
        sys.argv = ["main.py", *args]
        cap = _LogCapture(run_id)
        with contextlib.redirect_stdout(cap), contextlib.redirect_stderr(cap):
            try:
                main_module.cli.main(args=args, standalone_mode=False, prog_name="main.py")
                cap.flush()
                return 0
            except SystemExit as e:
                cap.flush()
                code = e.code
                if code is None:
                    return 0
                return int(code) if isinstance(code, int) else 1
    finally:
        sys.argv = old_argv
        try:
            os.chdir(old_cwd)
        except OSError:
            pass


def build_scrape_args(user_id: str) -> list[str]:
    from scrape_budget import (
        SCRAPE_TOTAL_MAX,
        build_scrape_queries,
        per_query_max,
    )

    queries: list[str] = []
    loc = "Paris"
    try:
        res = client().table("profiles").select("*").eq("id", user_id).maybe_single().execute()
        prof = res.data
        if prof:
            roles = prof.get("target_roles") or []
            locs = prof.get("target_locations") or []
            ai = None
            try:
                from utils.helpers import load_config, get_api_key
                from search_queries import load_hunt_queries_for_user

                config = load_config(BASE / "config.yaml")
                api_key = get_api_key(config)
                ai = load_hunt_queries_for_user(user_id, api_key)
            except Exception:
                pass
            queries = build_scrape_queries(roles, ai)
            if locs:
                loc = locs[0]
    except Exception:
        pass

    max_per = per_query_max(len(queries) or 1)
    args = [
        "scrape",
        "-p", "linkedin",
        "-m", str(max_per),
        "--max-total", str(SCRAPE_TOTAL_MAX),
        "-l", loc,
    ]
    for q in queries:
        args.extend(["-q", q])
    return args


def build_hunt_fill_args(user_id: str, target: int = HUNT_TARGET) -> list[str]:
    args = [
        "hunt-fill",
        "--target", str(target),
        "--min-score", str(MIN_SCORE),
        "--max-analyzed", str(MAX_ANALYZED_POOR_FIT),
        "--no-dashboard",
    ]
    try:
        res = client().table("profiles").select("*").eq("id", user_id).maybe_single().execute()
        prof = res.data or {}
        roles = prof.get("target_roles") or []
        locs = prof.get("target_locations") or ["Paris"]
        for q in roles[:8]:
            args.extend(["-q", q])
        args.extend(["-l", locs[0]])
    except Exception:
        args.extend(["-l", "Paris"])
    return args


def count_qualifying_new(user_id: str, urls_before: set, min_score: int = MIN_SCORE) -> int:
    jobs = load_jobs(user_id=user_id)
    n = 0
    for j in jobs:
        url = j.get("url")
        if not url or url in urls_before:
            continue
        s = j.get("_fit_score") if isinstance(j.get("_fit_score"), int) else j.get("fit_score")
        if isinstance(s, int) and s >= min_score:
            n += 1
    return n


def _job_scores(jobs: list, urls_scope: set | None = None) -> list[int]:
    scores = []
    for j in jobs:
        url = j.get("url")
        if urls_scope is not None and url not in urls_scope:
            continue
        s = j.get("_fit_score") if isinstance(j.get("_fit_score"), int) else j.get("fit_score")
        if isinstance(s, int):
            scores.append(s)
    return scores


def compute_fit_health(user_id: str, urls_scope: set | None = None) -> dict:
    scores = _job_scores(load_jobs(user_id=user_id), urls_scope)
    if not scores:
        return {"analyzed": 0, "poor_fit": False}
    qualifying = sum(1 for s in scores if s >= MIN_SCORE)
    avg = round(sum(scores) / len(scores), 1)
    poor = len(scores) >= 12 and (
        qualifying == 0 or avg <= 3.5 or (len(scores) >= 20 and qualifying / len(scores) <= 0.03)
    )
    return {
        "analyzed": len(scores),
        "avg": avg,
        "qualifying": qualifying,
        "max": max(scores),
        "poor_fit": poor,
    }


def log_poor_fit_warning(run_id: str, health: dict, scope: str = "cette recherche"):
    if not health.get("poor_fit"):
        return
    q = health.get("qualifying", 0)
    qual_txt = f"{q} ≥{MIN_SCORE}/10" if q else f"aucune ≥{MIN_SCORE}/10"
    pipeline_log(run_id, "")
    pipeline_log(run_id, "⚠️ ALERTE FIT : décalage profil / recherche probable")
    pipeline_log(
        run_id,
        f"   {health['analyzed']} offres ({scope}) · moyenne {health['avg']}/10 · {qual_txt}",
    )
    pipeline_log(run_id, "   → Vérifiez vos mots-clés et que votre CV correspond au métier visé.")
    pipeline_log(run_id, "")


def track_search_criteria(user_id: str, run_id: str):
    """Mémorise les critères de recherche (pour cache requêtes IA), sans invalider les analyses."""
    import hashlib
    import json as _json

    try:
        res = (
            client().table("profiles")
            .select("target_roles,target_locations,contract_type,remote_pref,salary_min")
            .eq("id", user_id).maybe_single().execute()
        )
        prof = res.data or {}
        h = hashlib.sha1(
            _json.dumps(prof, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()

        key = f"criteria:{user_id}"
        prev_h = None
        try:
            prev = client().table("app_state").select("data").eq("id", key).maybe_single().execute()
            if prev.data:
                prev_h = (prev.data.get("data") or {}).get("hash")
        except Exception:
            pass

        if prev_h and prev_h != h:
            pipeline_log(run_id, "📋 Critères de recherche mis à jour, les analyses existantes sont conservées")

        client().table("app_state").upsert(
            {"id": key, "data": {"hash": h}}, on_conflict="id"
        ).execute()
    except Exception as e:
        pipeline_log(run_id, f"⚠ Suivi critères : {str(e)[:100]}")


def _job_urls(user_id: str) -> set:
    return {j.get("url") for j in load_jobs(user_id=user_id) if j.get("url")}


def _urls_with_docs(user_id: str) -> set:
    try:
        res = (
            client().table("jobs")
            .select("url,cv_url")
            .eq("user_id", user_id)
            .eq("deleted", False)
            .execute()
        )
        return {r["url"] for r in (res.data or []) if r.get("url") and r.get("cv_url")}
    except Exception:
        return set()


def _has_cv(user_id: str) -> bool:
    try:
        res = (
            client().table("profiles")
            .select("cv_url")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        return bool(((res.data or {}).get("cv_url") or "").strip())
    except Exception:
        return False


def _qualifying_urls(user_id: str, urls_before: set | None = None, limit: int = HUNT_TARGET) -> list[str]:
    out: list[str] = []
    for j in load_jobs(user_id=user_id):
        url = j.get("url")
        if not url or (urls_before is not None and url in urls_before):
            continue
        s = j.get("_fit_score") if isinstance(j.get("_fit_score"), int) else j.get("fit_score")
        if isinstance(s, int) and s >= MIN_SCORE:
            out.append(url)
            if len(out) >= limit:
                break
    return out


def _run_generation_or_mark_ready(
    user_id: str,
    run_id: str,
    urls_before: set | None,
    docs_before: set,
    progress_after: int = 92,
) -> list[str]:
    """Génère CV+lettres si CV présent, sinon marque les offres qualifiantes comme prêtes."""
    if _has_cv(user_id):
        pipeline_log(run_id, "\n── Étape 2 : Génération CV + lettres (offres ≥ 6/10) ──")
        rc = run_main(
            ["apply", "--min-score", "6", "--max", str(HUNT_TARGET), "--no-dashboard"],
            user_id,
            run_id,
        )
        if rc == 130 and urls_before is not None:
            _exit_if_cancelled(run_id, user_id, urls_before)
        if rc != 0:
            pipeline_log(run_id, "⚠ La génération a échoué. Les offres restent visibles sans documents.")
            return []
        pipeline_set_status(run_id, "running", progress=progress_after)
        sync_documents(user_id, run_id)
        return list(_urls_with_docs(user_id) - docs_before)

    ready_urls = _qualifying_urls(user_id, urls_before)
    pipeline_log(run_id, "\n── Étape 2 : Pas de CV, génération ignorée ──")
    pipeline_log(
        run_id,
        f"✓ {len(ready_urls)} offre(s) repérée(s) comme dossiers prêts (score ≥ {MIN_SCORE}/10)",
    )
    if ready_urls:
        n = mark_ready_without_cv(user_id, ready_urls)
        pipeline_log(run_id, f"✓ {n} dossier(s) prêt(s) sans CV ni lettre (économie de tokens)")
    pipeline_set_status(run_id, "running", progress=progress_after)
    return ready_urls


def sync_documents(user_id: str, run_id: str):
    """Upload CV/lettres générés vers Supabase pour le dashboard web."""
    pipeline_log(run_id, "📤 Synchronisation des documents avec le dashboard…")
    try:
        n = upload_app_documents(user_id, APPS_DIR)
        pipeline_log(run_id, f"✓ {n} candidature(s) avec CV + lettre liés au dashboard")
    except Exception as e:
        pipeline_log(run_id, f"⚠ Upload documents : {str(e)[:120]}")


def test_chromium_launch(run_id: str) -> None:
    """Ouvre Chromium 3s pour valider le chemin (mode debug agent)."""
    import time
    from scrapers.autofill import _resolve_chromium_executable

    exe = _resolve_chromium_executable()
    pipeline_log(run_id, f"frozen={getattr(sys, 'frozen', False)}")
    pipeline_log(run_id, f"PLAYWRIGHT_BROWSERS_PATH={os.environ.get('PLAYWRIGHT_BROWSERS_PATH', '')}")
    pipeline_log(run_id, f"Chromium résolu : {exe or 'AUCUN'}")

    if not exe or not Path(exe).exists():
        pipeline_log(run_id, "❌ Chromium introuvable. Lancez : playwright install chromium")
        pipeline_finish(run_id, "failed", {"step": "chromium-test"})
        sys.exit(1)

    from playwright.sync_api import sync_playwright
    pipeline_log(run_id, "🪄 Ouverture de Chromium…")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False, executable_path=exe)
        page = browser.new_page()
        page.goto("about:blank")
        pipeline_log(run_id, "✓ Chromium ouvert avec succès")
        time.sleep(3)
        browser.close()
    pipeline_log(run_id, "✅ Test Chromium OK")
    pipeline_finish(run_id, "done", {"mode": "test-chromium"})


def ensure_chromium(run_id: str) -> bool:
    """Vérifie que Chromium Playwright est installé, sinon le télécharge."""
    try:
        from scrapers.autofill import _resolve_chromium_executable
        exe = _resolve_chromium_executable()
        if exe and Path(exe).exists():
            pipeline_log(run_id, f"✓ Chromium trouvé : {Path(exe).name}")
            return True
        if exe:
            pipeline_log(run_id, f"⚠ Chemin Chromium invalide : {exe[:120]}")
    except Exception as e:
        pipeline_log(run_id, f"⚠ Résolution Chromium : {str(e)[:80]}")
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            if Path(p.chromium.executable_path).exists():
                return True
    except Exception:
        pass

    pipeline_log(run_id, "📥 Première utilisation : téléchargement du navigateur Chromium (~1 min)…")
    env = os.environ.copy()
    if getattr(sys, "frozen", False):
        from playwright._impl._driver import compute_driver_executable, get_driver_env
        node, cli = compute_driver_executable()
        cmd = [node, cli, "install", "chromium"]
        env = get_driver_env()
        # Installe dans le même cache que celui utilisé au lancement.
        browsers_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
        if browsers_path:
            env["PLAYWRIGHT_BROWSERS_PATH"] = browsers_path
    else:
        cmd = [sys.executable, "-m", "playwright", "install", "chromium"]

    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode == 0:
        pipeline_log(run_id, "✓ Chromium installé. Il s'ouvrira automatiquement à chaque auto-apply.")
        return True
    err = (proc.stderr or proc.stdout or "")[:200]
    pipeline_log(run_id, f"❌ Installation Chromium échouée : {err}")
    return False


def count_pending_analysis(user_id: str) -> int:
    jobs = load_jobs(user_id=user_id)
    n = 0
    for j in jobs:
        s = j.get("_fit_score") if isinstance(j.get("_fit_score"), int) else j.get("fit_score")
        if not isinstance(s, int):
            n += 1
    return n


def run_analyze_pending(user_id: str, run_id: str):
    """Analyse les offres sans score + génère CV/lettres pour les ≥6/10 (pas de scrape)."""
    pipeline_set_status(run_id, "running", progress=8)
    pending = count_pending_analysis(user_id)
    pipeline_log(run_id, "📊 Reprise : analyse des offres en attente")
    pipeline_log(run_id, f"   {pending} offre(s) sans score, pas de nouveau scraping LinkedIn\n")

    if pending == 0:
        pipeline_log(run_id, "✓ Toutes vos offres sont déjà analysées.")
        pipeline_finish(run_id, "done", {"mode": "analyze", "pending": 0, "analyzed": 0})
        return

    docs_before = _urls_with_docs(user_id)

    pipeline_set_status(run_id, "running", progress=15)
    pipeline_log(run_id, "\n── Étape 2 : Analyse Claude (score /10) ──")
    rc = run_main(["analyze"], user_id, run_id)
    if rc == 130:
        _exit_if_cancelled(run_id, user_id)
    if rc != 0:
        pipeline_log(run_id, "❌ L'analyse a échoué.")
        pipeline_finish(run_id, "failed", {"step": "analyze", "mode": "analyze"})
        sys.exit(rc)

    remaining = count_pending_analysis(user_id)
    analyzed = max(0, pending - remaining)

    pipeline_set_status(run_id, "running", progress=55)
    fit_health = compute_fit_health(user_id)
    log_poor_fit_warning(run_id, fit_health, scope="vos offres")

    pipeline_set_status(run_id, "running", progress=65)
    generated_urls = _run_generation_or_mark_ready(
        user_id, run_id, None, docs_before, progress_after=92
    )
    fit_health = compute_fit_health(user_id)
    log_poor_fit_warning(run_id, fit_health, scope="vos offres")

    pipeline_log(
        run_id,
        f"\n📊 {analyzed} offre(s) analysée(s) · {len(generated_urls)} dossier(s) prêt(s)",
    )
    pipeline_log(run_id, "\n✅ Terminé. Rafraîchissez le dashboard pour voir les scores.")
    pipeline_finish(run_id, "done", {
        "mode": "analyze",
        "pending": pending,
        "analyzed": analyzed,
        "generated_urls": generated_urls,
        "fit_health": fit_health,
        "skip_docs": not _has_cv(user_id),
    })


def run_autoapply(user_id: str, run_id: str):
    """Ouvre Chromium et pré-remplit les formulaires des candidatures ≥6 générées."""
    pipeline_set_status(run_id, "running", progress=5)
    pipeline_log(run_id, "🤖 Auto-apply : préparation du navigateur…")
    if not ensure_chromium(run_id):
        pipeline_finish(run_id, "failed", {"step": "chromium-install"})
        sys.exit(1)

    pipeline_set_status(run_id, "running", progress=10)
    pipeline_log(run_id, "\n── Auto-apply : remplissage des formulaires ──")
    pipeline_log(run_id, "🪄 Chromium va s'ouvrir tout seul sur votre écran.")
    pipeline_log(run_id, "🔑 Première fois ? Connectez-vous à LinkedIn dans la fenêtre. La session est retenue.")
    pipeline_log(run_id, "✅ Chaque formulaire est pré-rempli : vérifiez, cliquez Submit, fermez Chromium à la fin.\n")

    selected = load_autoapply_selection(user_id)
    args = ["auto-apply", "--min-score", "6", "--no-dashboard"]
    if selected:
        from store import _normalize_job_url
        url_pass: list[str] = []
        seen_urls: set[str] = set()
        for x in selected:
            for candidate in (x.strip(), _normalize_job_url(x)):
                if candidate and candidate not in seen_urls:
                    seen_urls.add(candidate)
                    url_pass.append(candidate)
        os.environ["JA_AUTOAPPLY_URLS"] = ",".join(url_pass)
        clear_autoapply_selection(user_id)
        args.extend(["--max", str(min(len(selected), 20))])
        pipeline_log(run_id, f"📋 {len(selected)} offre(s) sélectionnée(s) dans le dashboard")
    else:
        args.extend(["--max", "20", "--recent-only"])

    rc = run_main(args, user_id, run_id)
    if rc == 130:
        _exit_if_cancelled(run_id, user_id)
    if rc != 0:
        pipeline_log(run_id, "❌ L'auto-apply a échoué.")
        pipeline_finish(run_id, "failed", {"step": "auto-apply"})
        sys.exit(rc)
    pipeline_log(run_id, "\n✅ Auto-apply terminé. Pensez à marquer les offres soumises.")
    pipeline_finish(run_id, "done", {"mode": "autoapply"})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--mode", default="full", choices=["full", "autoapply", "analyze", "test-chromium"])
    opts = parser.parse_args()

    run_id = opts.run_id
    set_user(opts.user_id)
    os.environ["JA_USER_ID"] = opts.user_id
    os.environ["JA_RUN_ID"] = run_id
    clear_profile_cache()
    pipeline_clear_cancel(run_id)
    pipeline_register_pid(run_id, os.getpid())

    if opts.mode == "test-chromium":
        test_chromium_launch(run_id)
        return

    if opts.mode == "autoapply":
        run_autoapply(opts.user_id, run_id)
        return

    if opts.mode == "analyze":
        run_analyze_pending(opts.user_id, run_id)
        return

    pipeline_set_status(run_id, "running", progress=5)
    pipeline_log(run_id, "🚀 JEAN PAUL : recherche lancée")
    track_search_criteria(opts.user_id, run_id)

    # Profil
    try:
        res = client().table("profiles").select("target_roles,target_locations").eq("id", opts.user_id).maybe_single().execute()
        prof = res.data or {}
        roles = prof.get("target_roles") or []
        locs = prof.get("target_locations") or ["Paris"]
        pipeline_log(run_id, f"📋 Postes : {', '.join(roles) or 'config par défaut'}")
        pipeline_log(run_id, f"📍 Lieux : {', '.join(locs)}")
    except Exception:
        pass

    urls_before = _job_urls(opts.user_id)
    docs_before = _urls_with_docs(opts.user_id)

    pipeline_set_status(run_id, "running", progress=10)
    pipeline_log(
        run_id,
        f"\n── Étape 1 : Recherche + analyse (arrêt à {HUNT_TARGET} offres ≥{MIN_SCORE}/10) ──",
    )
    rc = run_main(build_hunt_fill_args(opts.user_id, HUNT_TARGET), opts.user_id, run_id)
    if rc == 130:
        _exit_if_cancelled(run_id, opts.user_id, urls_before)
    if rc != 0:
        pipeline_log(run_id, "❌ La recherche a échoué.")
        pipeline_finish(run_id, "failed", {"step": "hunt"})
        sys.exit(rc)

    pipeline_set_status(run_id, "running", progress=55)
    qualifying = count_qualifying_new(opts.user_id, urls_before)
    new_urls_so_far = _job_urls(opts.user_id) - urls_before
    fit_health = compute_fit_health(opts.user_id, new_urls_so_far)
    log_poor_fit_warning(run_id, fit_health)

    if qualifying >= HUNT_TARGET:
        pipeline_log(run_id, f"✓ {qualifying} offre(s) ≥{MIN_SCORE}/10, objectif atteint")
    elif qualifying > 0:
        pipeline_log(
            run_id,
            f"⚠ {qualifying}/{HUNT_TARGET} offres ≥{MIN_SCORE}/10, requêtes épuisées",
        )
    else:
        pipeline_log(
            run_id,
            f"⚠ Aucune offre ≥{MIN_SCORE}/10, marché saturé ou critères très serrés",
        )

    pipeline_set_status(run_id, "running", progress=65)
    generated_urls = _run_generation_or_mark_ready(
        opts.user_id, run_id, urls_before, docs_before, progress_after=92
    )

    new_urls = list(_job_urls(opts.user_id) - urls_before)
    fit_health = compute_fit_health(opts.user_id, set(new_urls))
    log_poor_fit_warning(run_id, fit_health)

    pipeline_log(
        run_id,
        f"\n📊 {len(new_urls)} nouvelle(s) offre(s) · {qualifying} ≥{MIN_SCORE}/10 · {len(generated_urls)} dossier(s) prêt(s)",
    )
    pipeline_log(run_id, "\n✅ Terminé. Rafraîchissez le dashboard pour voir les offres.")
    pipeline_finish(run_id, "done", {
        "mode": "full",
        "new_urls": new_urls,
        "generated_urls": generated_urls,
        "qualifying_new": qualifying,
        "fit_health": fit_health,
        "skip_docs": not _has_cv(opts.user_id),
    })


if __name__ == "__main__":
    run_id = os.environ.get("JA_RUN_ID", "")
    try:
        main()
    except Exception as e:
        if run_id:
            try:
                pipeline_log(run_id, f"❌ Erreur moteur : {e}")
                pipeline_finish(run_id, "failed", {"error": str(e)[:200]})
            except Exception:
                pass
        sys.exit(1)
