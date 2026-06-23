#!/usr/bin/env python3
"""
Harness d'évaluation de l'auto-apply — LOCAL UNIQUEMENT.

But : mesurer, ATS par ATS, à quel point l'agent sait atteindre le formulaire,
lire les champs et les remplir, SANS jamais soumettre. Rien ici n'est branché
sur la prod (run_for_user.py / pipeline web ne l'importent pas).

Pour chaque URL :
  1. détecte l'ATS,
  2. lance smart_fill en dry-run (auto_submit=False, pause=False),
  3. capture une trace JSON (ATS, champs remplis/échoués, étapes) + screenshots,
  4. agrège un scorecard par ATS.

Usage :
    cd engine
    python eval_autoapply.py                      # lit eval_urls.json
    python eval_autoapply.py --config eval_urls.json
    python eval_autoapply.py --only lever,ashby    # filtre par ATS
    python eval_autoapply.py --url https://...      # un seul lien ad hoc

Sortie : engine/eval_runs/<timestamp>/
    scorecard.json + scorecard imprimé + un dossier par cible (trace + shots).

Prérequis : ANTHROPIC_API_KEY (engine/.env ou env), Chromium Playwright installé.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(BASE_DIR / ".env")
except Exception:
    pass

from rich.console import Console
from rich.table import Table

from utils.helpers import load_config, get_api_key
from scrapers.autofill import AutoFiller, detect_ats

console = Console()

CONFIG_FILE = BASE_DIR / "config.yaml"
DEFAULT_EVAL_CONFIG = BASE_DIR / "eval_urls.json"
EVAL_RUNS_DIR = BASE_DIR / "eval_runs"
DEBUG_DIR = Path.home() / ".job-apply-browser" / "debug"
AUTOFILL_MODEL = "claude-sonnet-4-6"

DEFAULT_LETTER = (
    "Madame, Monsieur,\n\nVivement intéressé par ce poste, je pense que mon "
    "profil correspond à vos attentes. Je serais ravi d'échanger.\n\nCordialement."
)


def _slug(value: str) -> str:
    keep = [c if c.isalnum() else "-" for c in value.lower()]
    return "".join(keep).strip("-")[:40] or "x"


def _load_targets(config_path: Path, only: set[str] | None, ad_hoc_url: str | None):
    """Retourne (cv_path, letter, [ {ats_expected, url}, ... ])."""
    if ad_hoc_url:
        return None, DEFAULT_LETTER, [{"ats": detect_ats(ad_hoc_url), "url": ad_hoc_url}]

    if not config_path.exists():
        console.print(f"[red]Config introuvable : {config_path}[/red]")
        console.print("[dim]Crée eval_urls.json (voir le modèle fourni).[/dim]")
        sys.exit(1)

    data = json.loads(config_path.read_text(encoding="utf-8"))
    cv_path = data.get("cv_path") or None
    letter = data.get("letter") or DEFAULT_LETTER
    targets = []
    for t in data.get("targets", []):
        url = (t.get("url") or "").strip()
        if not url:
            continue
        ats = (t.get("ats") or "").strip().lower() or detect_ats(url)
        if only and ats not in only:
            continue
        targets.append({"ats": ats, "url": url})
    return cv_path, letter, targets


def _snapshot_debug_names() -> set[str]:
    if not DEBUG_DIR.exists():
        return set()
    return {p.name for p in DEBUG_DIR.glob("*.png")}


def _collect_new_screenshots(before: set[str], dest: Path) -> list[str]:
    if not DEBUG_DIR.exists():
        return []
    new = sorted(p for p in DEBUG_DIR.glob("*.png") if p.name not in before)
    saved = []
    for p in new:
        try:
            shutil.copy2(p, dest / p.name)
            saved.append(p.name)
        except Exception:
            pass
    return saved


def _run_one(filler: AutoFiller, target: dict, cv_path, letter: str,
             api_key: str, model: str, out_dir: Path) -> dict:
    url = target["url"]
    expected = target["ats"]
    detected = detect_ats(url)

    case_dir = out_dir / f"{_slug(expected)}_{_slug(detected)}_{_slug(url[8:])}"
    case_dir.mkdir(parents=True, exist_ok=True)

    job = {
        "url": url,
        "title": "Évaluation",
        "company": "Eval",
        "type": "offer",
    }

    filler._last_run_summary = None
    shots_before = _snapshot_debug_names()

    result = {
        "url": url,
        "dir": case_dir.name,
        "ats_expected": expected,
        "ats_detected": detected,
        "ats_match": expected == detected,
        "ok": False,
        "fields_filled": 0,
        "fields_failed": 0,
        "steps": 0,
        "error": None,
        "screenshots": [],
    }

    t0 = time.time()
    try:
        ok = filler.smart_fill(
            job,
            cv_path if cv_path else Path(""),
            letter,
            api_key=api_key,
            model=model,
            app_dir=case_dir,
            auto_submit=False,
            pause=False,
        )
        result["ok"] = bool(ok)
    except Exception as e:
        result["error"] = f"{type(e).__name__}: {e}"
        (case_dir / "error.txt").write_text(traceback.format_exc(), encoding="utf-8")

    result["duration_s"] = round(time.time() - t0, 1)

    summary = getattr(filler, "_last_run_summary", None)
    if summary:
        result["ats_detected"] = summary.get("ats", detected)
        result["fields_filled"] = summary.get("fields_filled", 0)
        result["fields_failed"] = summary.get("fields_failed", 0)
        result["steps"] = summary.get("steps", 0)

    result["screenshots"] = _collect_new_screenshots(shots_before, case_dir)
    (case_dir / "trace.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return result


def _print_scorecard(results: list[dict]):
    table = Table(title="Scorecard auto-apply", show_lines=False)
    table.add_column("ATS", style="cyan")
    table.add_column("Détecté")
    table.add_column("Atteint", justify="center")
    table.add_column("Remplis", justify="right")
    table.add_column("Échecs", justify="right")
    table.add_column("Étapes", justify="right")
    table.add_column("Durée", justify="right")
    table.add_column("URL", overflow="fold")

    for r in results:
        reached = "✅" if r["ok"] else ("⚠️" if r["fields_filled"] else "❌")
        ats_cell = r["ats_expected"]
        if not r["ats_match"]:
            ats_cell += f" →{r['ats_detected']}"
        table.add_row(
            ats_cell,
            "ok" if r["ats_match"] else "[yellow]≠[/yellow]",
            reached,
            str(r["fields_filled"]),
            str(r["fields_failed"]),
            str(r["steps"]),
            f"{r.get('duration_s', 0)}s",
            r["url"][:50],
        )
    console.print(table)

    n = len(results) or 1
    reached = sum(1 for r in results if r["ok"])
    any_fill = sum(1 for r in results if r["fields_filled"])
    ats_ok = sum(1 for r in results if r["ats_match"])
    console.print(
        f"\n[bold]Total {len(results)}[/bold]  |  "
        f"ATS détecté correctement : {ats_ok}/{n}  |  "
        f"formulaire rempli & arrêt propre : {reached}/{n}  |  "
        f"au moins 1 champ rempli : {any_fill}/{n}"
    )


def main():
    parser = argparse.ArgumentParser(description="Harness d'éval auto-apply (local).")
    parser.add_argument("--config", default=str(DEFAULT_EVAL_CONFIG),
                        help="JSON des cibles (def. eval_urls.json)")
    parser.add_argument("--only", default="",
                        help="Filtre ATS séparés par des virgules (ex. lever,ashby)")
    parser.add_argument("--url", default="", help="Évalue une seule URL ad hoc")
    parser.add_argument("--model", default=AUTOFILL_MODEL, help="Modèle Claude")
    parser.add_argument("--out", default="", help="Dossier de sortie (def. eval_runs/<ts>)")
    parser.add_argument("--headless", action="store_true",
                        help="Navigateur sans fenêtre (déconseillé : login LinkedIn)")
    args = parser.parse_args()

    only = {s.strip().lower() for s in args.only.split(",") if s.strip()} or None
    cv_path, letter, targets = _load_targets(Path(args.config), only, args.url or None)

    if not targets:
        console.print("[yellow]Aucune cible à évaluer.[/yellow]")
        return

    try:
        config = load_config(CONFIG_FILE)
        api_key = get_api_key(config)
    except Exception as e:
        console.print(f"[red]{e}[/red]")
        sys.exit(1)

    if cv_path and not Path(cv_path).exists():
        console.print(f"[yellow]CV introuvable ({cv_path}) — on continue sans.[/yellow]")
        cv_path = None

    if args.out:
        out_dir = Path(args.out)
    else:
        out_dir = EVAL_RUNS_DIR / datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=True)
    console.print(f"[bold cyan]Éval auto-apply — {len(targets)} cible(s)[/bold cyan]")
    console.print(f"[dim]Sortie : {out_dir}[/dim]\n")

    filler = AutoFiller(headless=args.headless)
    results = []
    try:
        for i, target in enumerate(targets, 1):
            console.rule(f"[{i}/{len(targets)}] {target['ats']} — {target['url'][:60]}")
            r = _run_one(filler, target, cv_path, letter, api_key, args.model, out_dir)
            results.append(r)
            time.sleep(1.0)
    finally:
        try:
            filler._close()
        except Exception:
            pass

    (out_dir / "scorecard.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    console.print()
    _print_scorecard(results)
    console.print(f"\n[green]Scorecard → {out_dir / 'scorecard.json'}[/green]")


if __name__ == "__main__":
    main()
