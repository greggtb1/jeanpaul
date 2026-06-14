#!/usr/bin/env python3
"""
Job Apply -- automatise ta recherche d'emploi.

Usage :
  python main.py scrape             # scrape les offres selon config.yaml
  python main.py list               # affiche les offres scrapées
  python main.py apply --all        # genere CV + lettre pour toutes les offres
  python main.py apply --ids 1,3,5  # genere seulement pour les offres selectionnees
  python main.py apply --min-score 7  # genere pour les offres avec fit >= 7
"""

import sys
import json
import time
import re
import webbrowser
import random
import os
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import click
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich import print as rprint

# -- Chemins -----------------------------------------------------------------
BASE_DIR = Path(__file__).parent
JOBS_FILE = BASE_DIR / "jobs.json"
SEEN_FILE = BASE_DIR / "seen.json"
APPLIED_FILE = BASE_DIR / "applied.json"
CONFIG_FILE = BASE_DIR / "config.yaml"

sys.path.insert(0, str(BASE_DIR))

from utils.helpers import (
    load_config, get_api_key,
    filter_jobs, dedup_jobs, make_app_dir,
    job_key, filter_new_jobs,
    sort_by_freshness, filter_by_age,
)
# Persistance branchée sur Supabase (mêmes signatures que les helpers JSON)
from store import (
    load_jobs, save_jobs,
    load_seen, save_seen,
    load_applied, save_applied,
    list_autoapply_jobs,
    recent_generated_urls,
    ensure_local_docs,
    _coerce_fit_score,
    _urls_overlap,
    client as supabase_client,
)
from dashboard import generate as generate_dashboard
from scrapers.wttj import WTTJScraper
from scrapers.linkedin import LinkedInScraper
from scrapers.indeed import IndeedScraper, INDEED_TIERS
from scrapers.wttj_startups import WTTJStartupScraper
from scrapers.autofill import AutoFiller, detect_ats
from generators.analyzer import JobAnalyzer
from generators.cover_letter import CoverLetterGenerator
from generators.cv_builder import CVBuilder
from generators.spontaneous import SpontaneousGenerator
from user_profile import cv_filename_for

console = Console()

DASHBOARD_URL = "http://127.0.0.1:7433/"
USER_STATE_FILE = BASE_DIR / "user_state.json"

# Modele leger pour les tâches structurées (fit score, analyse spontanée)
ANALYSIS_MODEL = "claude-haiku-4-5-20251001"
# Mapping de champs : Sonnet (qualité prime — Haiku se mélangeait les pinceaux sur les forms complexes)
AUTOFILL_MODEL = "claude-sonnet-4-6"


def _get_deleted_idxs() -> set:
    """Retourne l'ensemble des _idx (int) des offres supprimées depuis le dashboard.
    L'état est désormais stocké dans Supabase (app_state)."""
    try:
        from store import load_state
        data = load_state()
        return {int(x) for x in data.get("deleted", [])}
    except Exception:
        return set()


def _sync_deleted_to_seen(output_dir: Path) -> int:
    """Injecte les URLs des offres supprimées dans seen.json ET applied.json.

    Garantit que même si jobs.json est vidé/corrompu, les offres supprimées
    ne seront jamais re-scrapées ni re-générées.
    Retourne le nombre d'URLs nouvellement protégées.
    """
    deleted_idxs = _get_deleted_idxs()
    if not deleted_idxs:
        return 0

    seen    = load_seen(SEEN_FILE)
    applied = load_applied(APPLIED_FILE)
    added   = 0

    for idx in deleted_idxs:
        # Cherche le dossier applications/{idx:03d}_*
        pattern = f"{idx:03d}_*"
        folders = sorted(output_dir.glob(pattern))
        if not folders:
            # Essaie sans padding (anciens dossiers)
            folders = sorted(output_dir.glob(f"{idx}_*"))
        for folder in folders:
            info_path = folder / "job_info.json"
            if not info_path.exists():
                continue
            try:
                info = json.loads(info_path.read_text(encoding="utf-8"))
                url  = info.get("job", {}).get("url", "")
                if url and url not in seen:
                    seen.add(url)
                    applied.add(url)
                    added += 1
                elif url:
                    # Déjà dans seen, mais s'assure que applied le sait aussi
                    if url not in applied:
                        applied.add(url)
                        added += 1
            except Exception:
                pass

    if added:
        save_seen(seen, SEEN_FILE)
        save_applied(applied, APPLIED_FILE)

    return added


def _ensure_state_server():
    """Lance le serveur d'etat comme processus independant si pas deja actif."""
    import subprocess, urllib.request as _ur, time as _time
    server_script = BASE_DIR / "state_server.py"
    if not server_script.exists():
        return
    try:
        _ur.urlopen("http://127.0.0.1:7433/ping", timeout=0.5)
        console.print("[dim]Serveur d'etat deja actif[/dim]")
        return
    except Exception:
        pass
    try:
        subprocess.Popen(
            [sys.executable, str(server_script)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        for _ in range(10):
            _time.sleep(0.3)
            try:
                _ur.urlopen("http://127.0.0.1:7433/ping", timeout=0.5)
                console.print("[dim]Serveur d'etat demarre -> http://127.0.0.1:7433/[/dim]")
                return
            except Exception:
                pass
    except Exception as e:
        console.print(f"[dim]  (serveur etat indisponible : {e})[/dim]")


# ============================================================================
# CLI GROUP
# ============================================================================

@click.group()
def cli():
    """Job Apply -- automatisation de candidatures pour Gregoire Linee."""
    pass


# ============================================================================
# SCRAPE
# ============================================================================

@cli.command()
@click.option("--query", "-q", multiple=True)
@click.option("--location", "-l", default=None)
@click.option("--max", "-m", "max_per_query", default=None, type=int)
@click.option("--max-total", default=None, type=int, help="Plafond global d'offres brutes à récupérer")
@click.option("--platforms", "-p", default=None)
@click.option("--fetch-descriptions/--no-descriptions", default=True)
def scrape(query, location, max_per_query, max_total, platforms, fetch_descriptions):
    """Scrape les offres LinkedIn selon ta config."""
    config = load_config(CONFIG_FILE)
    search_cfg = config.get("search", {})
    queries = list(query) if query else search_cfg.get("queries", ["product manager"])
    loc = location or search_cfg.get("location", "Paris")
    max_r = max_per_query or search_cfg.get("max_per_query", 10)
    max_total_r = max_total or search_cfg.get("max_total", 0) or None
    platform_list = platforms.split(",") if platforms else search_cfg.get("platforms", ["linkedin"])
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")

    console.print(f"\n[bold cyan]Scraping...[/bold cyan]")
    console.print(f"   Requetes : {', '.join(queries)}")
    console.print(f"   Localisation : {loc}")
    console.print(f"   Plateformes : {', '.join(platform_list)}")
    console.print(f"   Max/requete : {max_r}")
    if max_total_r:
        console.print(f"   Budget total : {max_total_r} offres max\n")
    else:
        console.print("")

    # Ré-injecte les URLs supprimées dans seen.json avant de scraper
    # → les offres que l'utilisateur a supprimées ne reviennent jamais
    protected = _sync_deleted_to_seen(output_dir)
    if protected:
        console.print(f"   [dim]🛡  {protected} offre(s) supprimée(s) protégée(s) contre re-scrape[/dim]")

    seen = load_seen(SEEN_FILE)
    existing_jobs = load_jobs(JOBS_FILE)
    console.print(f"   Deja en memoire : {len(existing_jobs)} offres, {len(seen)} URLs vues\n")

    all_jobs = []
    recent_days = search_cfg.get("recent_days", 0)
    do_sort = search_cfg.get("sort_by_recent", True)

    def _budget_left() -> int | None:
        if not max_total_r:
            return None
        return max(0, max_total_r - len(all_jobs))

    if "wttj" in platform_list:
        wttj = WTTJScraper()
        for q in queries:
            left = _budget_left()
            if left is not None and left <= 0:
                console.print(f"   [dim]Budget {max_total_r} atteint — arret du scrape[/dim]")
                break
            qmax = min(max_r, left) if left is not None else max_r
            console.print(f"[cyan]WTTJ[/cyan] -> [italic]{q}[/italic]")
            jobs = wttj.search(q, location=loc, max_results=qmax, recent_days=recent_days)
            if left is not None:
                jobs = jobs[:left]
            console.print(f"   {len(jobs)} offres trouvees")
            if fetch_descriptions:
                for i, job in enumerate(jobs):
                    if not job.get("description") and job.get("url"):
                        console.print(f"   [{i+1}/{len(jobs)}] Desc : {job['company']} - {job['title'][:40]}")
                        job["description"] = wttj.fetch_description(job["url"])
                        time.sleep(2)
            all_jobs.extend(jobs)

    if "linkedin" in platform_list:
        li = LinkedInScraper()
        for q in queries:
            left = _budget_left()
            if left is not None and left <= 0:
                console.print(f"   [dim]Budget {max_total_r} atteint — arret du scrape[/dim]")
                break
            qmax = min(max_r, left) if left is not None else max_r
            console.print(f"[blue]LinkedIn[/blue] -> [italic]{q}[/italic]")
            jobs = li.search(q, location=loc, max_results=qmax, recent_days=recent_days)
            if left is not None:
                jobs = jobs[:left]
            console.print(f"   {len(jobs)} offres trouvees")
            if fetch_descriptions:
                for i, job in enumerate(jobs):
                    if not job.get("description") and job.get("id"):
                        console.print(f"   [{i+1}/{len(jobs)}] Desc : {job['company']} - {job['title'][:40]}")
                        job["description"] = li.fetch_description(job["id"])
                        time.sleep(2)
            all_jobs.extend(jobs)

    new_jobs = filter_new_jobs(all_jobs, seen)
    console.print(f"\n   {len(all_jobs) - len(new_jobs)} offres ignorees (deja scrapees)")
    new_jobs = dedup_jobs(new_jobs)
    before = len(new_jobs)
    # Charge les target_roles du profil utilisateur pour filtrer stage/alternance
    _target_roles: list[str] = []
    _contract_type: list[str] = []
    try:
        from user_profile import load_user_profile
        _up = load_user_profile()
        _target_roles = _up.get("target_roles") or []
        _contract_type = _up.get("contract_type") or []
    except Exception:
        _target_roles = list(queries)
    new_jobs = filter_jobs(new_jobs, config, target_roles=_target_roles, contract_type=_contract_type)
    after = len(new_jobs)

    if recent_days > 0:
        before_age = len(new_jobs)
        new_jobs = filter_by_age(new_jobs, recent_days)
        dropped = before_age - len(new_jobs)
        if dropped:
            console.print(f"   {dropped} offres trop anciennes (>{recent_days}j) ignorees")
    if do_sort:
        new_jobs = sort_by_freshness(new_jobs)

    merged = existing_jobs + new_jobs
    for i, job in enumerate(merged):
        job["_idx"] = i + 1
    for job in all_jobs:
        seen.add(job_key(job))
    save_seen(seen, SEEN_FILE)
    save_jobs(merged, JOBS_FILE)

    console.print(f"[bold green]{after} nouvelles offres ajoutees[/bold green] ({before - after} filtrees)")
    console.print(f"   Total en base : {len(merged)} offres")


# ============================================================================
# LIST
# ============================================================================

@cli.command("list")
@click.option("--min-score", default=0, type=int)
def list_jobs(min_score):
    """Affiche les offres scrapees."""
    jobs = load_jobs(JOBS_FILE)
    if not jobs:
        console.print("[yellow]Aucune offre. Lance d'abord : python main.py scrape[/yellow]")
        return
    if min_score > 0:
        jobs = [j for j in jobs if j.get("_fit_score", 10) >= min_score]

    table = Table(title=f"{len(jobs)} offres", show_lines=True)
    table.add_column("#", style="dim", width=4)
    table.add_column("Titre", style="bold", max_width=30)
    table.add_column("Entreprise", max_width=20)
    table.add_column("Lieu", max_width=12)
    table.add_column("Plateforme", max_width=10)
    table.add_column("Fit", max_width=6)
    table.add_column("URL", max_width=40, style="dim")

    for job in jobs:
        score = job.get("_fit_score", "?")
        score_str = (
            f"[green]{score}/10[/green]" if isinstance(score, int) and score >= 7
            else f"[yellow]{score}/10[/yellow]" if isinstance(score, int) and score >= 5
            else f"{score}"
        )
        table.add_row(
            str(job.get("_idx", "?")),
            job.get("title", ""),
            job.get("company", ""),
            job.get("location", "Paris")[:12],
            job.get("platform", ""),
            score_str,
            job.get("url", "")[:40],
        )
    console.print(table)


# ============================================================================
# APPLY
# ============================================================================

@cli.command()
@click.option("--all", "apply_all", is_flag=True)
@click.option("--ids", default=None)
@click.option("--min-score", default=0, type=int)
@click.option("--max", "max_apply", default=15, type=int)
@click.option("--language", default="auto")
@click.option("--skip-cv", is_flag=True)
@click.option("--skip-analysis", is_flag=True)
@click.option("--no-dashboard", is_flag=True)
def apply(apply_all, ids, min_score, max_apply, language, skip_cv, skip_analysis, no_dashboard):
    """Genere CV + lettre de motivation personnalises."""
    config = load_config(CONFIG_FILE)
    api_key = get_api_key(config)
    model = config.get("anthropic", {}).get("model", "claude-opus-4-6")
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")

    jobs = load_jobs(JOBS_FILE)
    if not jobs:
        console.print("[red]Aucune offre. Lance d'abord : python main.py scrape[/red]")
        return

    # Exclut TOUJOURS les offres supprimées du dashboard (double protection)
    deleted_idxs = _get_deleted_idxs()
    if deleted_idxs:
        before = len(jobs)
        jobs = [j for j in jobs if j.get("_idx") not in deleted_idxs]
        skipped = before - len(jobs)
        if skipped:
            console.print(f"   [dim]🛡  {skipped} offre(s) supprimée(s) du dashboard exclue(s)[/dim]")

    if ids:
        selected_ids = [int(x.strip()) for x in ids.split(",")]
        selected = [j for j in jobs if j.get("_idx") in selected_ids]
    elif min_score > 0:
        selected = [j for j in jobs if j.get("_fit_score", 0) >= min_score]
    elif apply_all:
        selected = jobs
    else:
        console.print("[yellow]Precise --all, --ids 1,3,5 ou --min-score 7[/yellow]")
        return

    if not selected:
        console.print("[yellow]Aucune offre selectionnee.[/yellow]")
        return

    applied = load_applied(APPLIED_FILE)
    already_done = [j for j in selected if job_key(j) in applied]
    selected = [j for j in selected if job_key(j) not in applied]
    if already_done:
        console.print(f"[dim]{len(already_done)} offre(s) ignoree(s) (deja candidatees)[/dim]")
    if not selected:
        console.print("[yellow]Toutes les offres selectionnees ont deja ete traitees.[/yellow]")
        return
    if max_apply > 0 and len(selected) > max_apply:
        console.print(f"[dim]Cap a {max_apply} candidatures — {len(selected) - max_apply} reportee(s)[/dim]")
        selected = selected[:max_apply]

    console.print(f"\n[bold cyan]{len(selected)} candidature(s) a generer...[/bold cyan]\n")

    analyzer = JobAnalyzer(api_key=api_key, model=ANALYSIS_MODEL)
    cl_gen = CoverLetterGenerator(api_key=api_key, model=model)
    cv_gen = CVBuilder(api_key=api_key, model=model) if not skip_cv else None
    results = []

    for i, job in enumerate(selected):
        company = job.get("company", "Unknown")
        title = job.get("title", "Unknown")
        idx = job.get("_idx", i + 1)
        console.print(f"\n[bold][{i+1}/{len(selected)}][/bold] {company} -- {title}")
        console.print(f"   [dim]{job.get('url', '')}[/dim]")

        already_analyzed = isinstance(job.get("_fit_score"), int)
        if not skip_analysis and not already_analyzed:
            console.print("   Analyse de l'offre...")
            analysis = analyzer.analyze(job)
            fit = analysis.get("fit_score", "?")
            console.print(f"   Fit score : [bold]{fit}/10[/bold] -- {analysis.get('fit_reasoning', '')}")
            job["_fit_score"] = fit
            job["_analysis"] = analysis
        else:
            analysis = job.get("_analysis") or analyzer._empty_analysis(job)
            if already_analyzed:
                console.print(f"   Fit score : [bold]{job['_fit_score']}/10[/bold] [dim](deja analyse)[/dim]")

        # _analysis en base n'inclut plus job — réinjecter pour CV / lettre
        if not (analysis.get("job") or {}).get("title"):
            analysis = {**analysis, "job": {k: v for k, v in job.items() if k != "_analysis"}}

        app_dir = make_app_dir(output_dir, idx, company, title)

        lang = language
        if lang == "auto":
            from job_language import language_from_analysis
            lang = language_from_analysis(analysis)

        console.print("   Generation de la lettre de motivation...")
        cl_path = app_dir / f"LettreMotivation_{company.replace(' ', '_')}.docx"
        result = cl_gen.generate_and_save(analysis, cl_path, language=lang)
        if result:
            console.print(f"   [green]Lettre[/green] -> {result.name}")
        else:
            console.print("   [red]Lettre echouee[/red]")

        if cv_gen:
            console.print("   Adaptation du CV...")
            cv_path = app_dir / cv_filename_for(company)
            cv_result = cv_gen.generate_and_save(analysis, cv_path, job=job)
            if cv_result:
                console.print(f"   [green]CV[/green] -> {cv_path.name}")
            else:
                console.print("   [red]CV echoue[/red]")

        summary_path = app_dir / "job_info.json"
        with open(summary_path, "w", encoding="utf-8") as f:
            json.dump({
                "job": {k: v for k, v in job.items() if k != "_analysis"},
                "fit_score": analysis.get("fit_score"),
                "fit_reasoning": analysis.get("fit_reasoning"),
                "role_summary": analysis.get("role_summary"),
                "key_responsibilities": analysis.get("key_responsibilities"),
                "required_skills": analysis.get("required_skills"),
                "why_interesting": analysis.get("why_interesting"),
            }, f, ensure_ascii=False, indent=2)

        applied.add(job_key(job))
        save_applied(applied, APPLIED_FILE)
        results.append({"company": company, "title": title, "dir": str(app_dir)})
        time.sleep(1)

    save_jobs(jobs, JOBS_FILE)
    console.print(f"\n[bold green]{len(results)} candidature(s) generee(s) ![/bold green]")
    for r in results:
        console.print(f"   {r['company']} -- {r['title']}")

    if not no_dashboard:
        dashboard_path = BASE_DIR / "dashboard.html"
        generate_dashboard(jobs, output_dir, dashboard_path)
        _ensure_state_server()
        console.print(f"\n[bold cyan]Dashboard -> {DASHBOARD_URL}[/bold cyan]")
        import subprocess as _sp
        try:
            _sp.run(["open", "-a", "Google Chrome", DASHBOARD_URL], check=True)
        except Exception:
            webbrowser.open(DASHBOARD_URL)



# ============================================================================
# ANALYZE
# ============================================================================

@cli.command()
@click.option("--min-score", default=6, type=int)
def analyze(min_score):
    """Analyse toutes les offres et affiche leur score de fit."""
    config = load_config(CONFIG_FILE)
    api_key = get_api_key(config)
    model = config.get("anthropic", {}).get("model", "claude-opus-4-6")

    jobs = load_jobs(JOBS_FILE)
    if not jobs:
        console.print("[red]Aucune offre. Lance : python main.py scrape[/red]")
        return

    # Exclut les offres supprimées du dashboard
    deleted_idxs = _get_deleted_idxs()
    if deleted_idxs:
        before = len(jobs)
        jobs = [j for j in jobs if j.get("_idx") not in deleted_idxs]
        skipped = before - len(jobs)
        if skipped:
            console.print(f"   [dim]🛡  {skipped} offre(s) supprimée(s) du dashboard ignorée(s)[/dim]")

    analyzer = JobAnalyzer(api_key=api_key, model=ANALYSIS_MODEL)
    applied = load_applied(APPLIED_FILE)

    to_analyze = [j for j in jobs if not isinstance(j.get("_fit_score"), int)]
    already = len(jobs) - len(to_analyze)
    if already:
        console.print(f"[dim]   {already} offre(s) deja analysee(s) -- ignorees[/dim]")
    if not to_analyze:
        console.print("[green]Toutes les offres sont deja analysees.[/green]")
        save_jobs(jobs, JOBS_FILE)
        return

    console.print(f"\n[bold cyan]Analyse de {len(to_analyze)} nouvelles offres...[/bold cyan]\n")

    for job in to_analyze:
        company = job.get("company", "?")
        title = job.get("title", "?")
        console.print(f"  -> {company} -- {title[:50]}", end="")
        analysis = analyzer.analyze(job)
        score = analysis.get("fit_score", "?")
        job["_fit_score"] = score
        job["_analysis"] = analysis
        color = "green" if isinstance(score, int) and score >= 7 else "yellow"
        console.print(f"  [{color}]{score}/10[/{color}]  {analysis.get('fit_reasoning', '')}")
        save_jobs(jobs, JOBS_FILE)

    save_jobs(jobs, JOBS_FILE)

    top = [j for j in jobs if isinstance(j.get("_fit_score"), int) and j["_fit_score"] >= min_score]
    top.sort(key=lambda x: x.get("_fit_score", 0), reverse=True)
    console.print(f"\n[bold]Top {len(top)} offres (fit >= {min_score})[/bold]")
    for j in top:
        console.print(f"  [{j['_fit_score']}/10] {j['company']} -- {j['title']}  [dim]{j.get('url', '')[:60]}[/dim]")
    console.print(f"\n[dim]Pour postuler : python main.py apply --min-score {min_score}[/dim]")


# ============================================================================
# HUNT -- logique partagee LinkedIn + Indeed
# ============================================================================

_HUNT_TIERS = [
    # Tier 1 -- coeur ops/strategy, en anglais et francais
    [
        "ops manager", "operations manager", "head of ops", "chief of staff",
        "business operations", "revenue operations", "responsable operations",
        "directeur operations", "head of strategy", "strategy manager",
        "ops",                          # requête courte — remonte des offres que les longues ratent
    ],
    # Tier 2 -- product + growth + bizdev
    [
        "product operations", "growth operations", "product manager",
        "operations lead", "revops manager", "bizdev manager",
        "business development manager", "responsable business development",
        "head of growth", "growth manager", "scaling manager",
        "product builder",              # profil builder / 0-to-1 / startup
    ],
    # Tier 3 -- roles adjacent pertinents
    [
        "head of product", "COO", "project manager", "programme manager",
        "transformation manager", "responsable transformation",
        "general manager", "country manager", "market manager",
        "partnerships manager", "responsable partenariats",
        "marketplace manager", "platform manager",
    ],
]

# ── Tiers PME/industrie -- roles ops & management, moins startup, plus métier ──
# Cible les ETI/PME qui cherchent un vrai bras droit ops, pas un PM SaaS
_HUNT_PME_TIERS = [
    # Tier 1 -- intitulés RH classiques PME, France
    [
        "responsable des opérations",
        "directeur des opérations",
        "responsable opérations",
        "directeur opérations",
        "responsable exploitation",
        "directeur exploitation",
        "directeur général adjoint",
        "secrétaire général",
    ],
    # Tier 2 -- management de projet et organisation
    [
        "responsable organisation",
        "responsable projets",
        "directeur de projet",
        "chef de projet opérationnel",
        "responsable amélioration continue",
        "directeur supply chain",
        "responsable supply chain",
        "responsable logistique",
        "directeur logistique",
    ],
    # Tier 3 -- management de site/BU/P&L
    [
        "directeur de site",
        "responsable de site",
        "directeur d'agence",
        "directeur de business unit",
        "directeur adjoint",
        "responsable développement",
        "directeur développement",
        "responsable performance",
        "head of operations",     # quelques PME utilisent l'anglais
        "COO",
    ],
]

# Niche PME -- termes très métier, faible concurrence, bon fit Gregoire
_HUNT_PME_NICHE = [
    "directeur de la transformation",
    "responsable transformation",
    "responsable pilotage",
    "responsable excellence opérationnelle",
    "chef d'exploitation",
    "responsable administration",
    "directeur administratif et financier",
    "responsable coordination",
    "coordinateur opérationnel",
    "responsable planification",
    "directeur des activités",
    "responsable de la croissance",
    "responsable développement commercial",
    "directeur commercial opérations",
    "bras droit fondateur",
    "directeur général de filiale",
]


# Tier niche -- roles moins concurrentiels, bon fit Gregoire (marketplace/mobility/ops)
# Tourne en mini-pass systematique a chaque run, indep de la cible principale
_HUNT_NICHE = [
    "city launcher",          # expansion geo (Uber, Bolt, Deliveroo-style)
    "city manager",           # ops terrain local
    "launcher",               # startup / nouveau marche
    "expansion manager",      # scale nouveaux marches
    "marketplace operations", # tres niche, direct fit
    "supply manager",         # cote offre marketplace
    "ecosystem manager",      # platform / reseau
    "category manager",       # vertical marketplace
    "vendor success manager",  # B2B marketplace cote vendeurs
    "community operations",   # ops communaute/reseau
    "entrepreneur in residence", # EIR startup studio
    "venture builder",        # startup studio
    "new markets manager",    # expansion internationale
    "fleet operations",       # mobility (vehicules, drivers)
    "network development",    # croissance reseau/plateforme
]


def _run_hunt(scraper, tiers: list, starts_file: Path, platform_label: str,
              target: int, min_score: int, location: str,
              config: dict, api_key: str, model: str, output_dir: Path,
              open_dashboard: bool = True,
              niche_queries: list = None,
              pme_mode: bool = False,
              find_only: bool = False,
              max_analyzed: int = 0) -> int:
    """
    Logique commune de chasse (LinkedIn ou Indeed).
    Pagine les tiers de requetes, filtre les offres deja vues,
    analyse le fit et genere CV + lettre pour les meilleures.
    find_only=True : scrape + analyse jusqu'a `target` offres >= min_score (sans CV).
    Retourne le nombre de candidatures generees ou d'offres qualifiantes.
    """
    from utils.helpers import INTERNSHIP_TITLE_KEYWORDS, _wants_internship
    exclude_kw = [k.lower() for k in config.get("filters", {}).get("exclude_keywords", [])]
    # Exclure stage/alternance du titre sauf si le profil les cherche explicitement
    try:
        from user_profile import load_user_profile as _lup
        _up = _lup()
        _roles = _up.get("target_roles") or []
        _contracts = _up.get("contract_type") or []
    except Exception:
        _roles = []
        _contracts = []
    if not _wants_internship(_roles, _contracts):
        exclude_kw = list(set(exclude_kw) | set(INTERNSHIP_TITLE_KEYWORDS))

    # Protège les offres supprimées : leurs URLs rejoignent seen.json + applied.json
    # avant tout crawl, pour qu'elles ne soient jamais re-scrapées ni re-générées
    _sync_deleted_to_seen(output_dir)
    deleted_idxs = _get_deleted_idxs()

    seen = load_seen(SEEN_FILE)
    jobs = load_jobs(JOBS_FILE)
    applied = load_applied(APPLIED_FILE)

    # Cache de pagination : memorise le dernier start par query
    starts: dict = {}
    if starts_file.exists():
        try:
            starts = json.loads(starts_file.read_text(encoding="utf-8"))
        except Exception:
            starts = {}

    # Set complet d'URLs deja vues
    seen_urls: set = set()
    for j in jobs:
        k = job_key(j)
        if k:
            seen_urls.add(k)
    seen_urls.update(seen)

    analyzer = JobAnalyzer(api_key=api_key, model=ANALYSIS_MODEL)
    cl_gen = CoverLetterGenerator(api_key=api_key, model=model, pme_mode=pme_mode)
    cv_gen = CVBuilder(api_key=api_key, model=model, pme_mode=pme_mode)

    generated = 0
    qualified = 0
    analyzed_count = 0

    def hit_target() -> bool:
        return (qualified if find_only else generated) >= target

    def analysis_cap_reached() -> bool:
        return max_analyzed > 0 and analyzed_count >= max_analyzed and not hit_target()

    def should_stop_hunt() -> bool:
        return hit_target() or analysis_cap_reached()

    def on_qualifying(job, analysis, score):
        nonlocal generated, qualified
        if not isinstance(score, int) or score < min_score:
            console.print(f"     [dim]Score {score} < {min_score} -- ignore[/dim]")
            return
        if find_only:
            qualified += 1
            console.print(f"     [green]Qualifiante {qualified}/{target} (≥{min_score}/10)[/green]")
            return
        company = job.get("company", "?")
        title = job.get("title", "?")
        idx = job.get("_idx", generated + 1)
        app_dir = make_app_dir(output_dir, idx, company, title)
        lang = analysis.get("language", "en")
        console.print(f"     Lettre...")
        cl_gen.generate_and_save(
            analysis,
            app_dir / f"LettreMotivation_{company.replace(' ', '_')[:30]}.txt",
            language=lang,
        )
        console.print(f"     CV...")
        cv_gen.generate_and_save(
            analysis,
            app_dir / cv_filename_for(company),
        )
        (app_dir / "job_info.json").write_text(
            json.dumps({
                "job": {k: v for k, v in job.items() if k != "_analysis"},
                "fit_score": score,
                "fit_reasoning": analysis.get("fit_reasoning"),
                "role_summary": analysis.get("role_summary"),
                "key_responsibilities": analysis.get("key_responsibilities"),
                "required_skills": analysis.get("required_skills"),
                "why_interesting": analysis.get("why_interesting"),
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        applied.add(job_key(job))
        save_applied(applied, APPLIED_FILE)
        generated += 1
        console.print(f"     [green]Candidature {generated}/{target} generee[/green]")

    def process_one(job, tag: str = "") -> bool:
        """Analyse une offre et la sauvegarde. False = cible atteinte, on s'arrête."""
        nonlocal jobs, analyzed_count
        if should_stop_hunt():
            return False
        company = job.get("company", "?")
        title = job.get("title", "?")
        label = f"[{tag}] " if tag else ""
        console.print(f"\n  {label}[bold]{company}[/bold] -- {title[:50]}")
        if not job.get("description") and job.get("id"):
            job["description"] = scraper.fetch_description(job["id"])
            time.sleep(1)
        console.print(f"     [dim]Analyse...[/dim]", end="")
        analysis = analyzer.analyze(job)
        analyzed_count += 1
        score = analysis.get("fit_score", 0)
        color = "green" if score >= 7 else "yellow" if score >= 5 else "red"
        console.print(f" [{color}]{score}/10[/{color}]  {analysis.get('fit_reasoning', '')[:80]}")
        job["_fit_score"] = score
        job["_analysis"] = analysis
        jobs = [j for j in jobs if job_key(j) != job_key(job)]
        jobs.append(job)
        for i, j in enumerate(jobs):
            j["_idx"] = i + 1
        save_jobs(jobs, JOBS_FILE)
        on_qualifying(job, analysis, score)
        return not should_stop_hunt()

    # ── Quick pass : tier 1 filtré sur les 3 derniers jours ──────────────────
    # Si des offres fraiches existent, on les traite en priorité avant la
    # routine normale. Max 2 pages par query, sans déplacer le cache de pagination.
    console.print(f"\n[bold cyan]-- Quick pass (offres < 3 jours) --[/bold cyan]")
    quick_jobs: list = []
    for q in tiers[0]:
        if len(quick_jobs) >= target * 2:
            break
        console.print(f"  [{platform_label}] -> [italic]{q}[/italic] [dim](recent)[/dim]", end="")
        found, _ = scraper.search_new(
            q,
            seen=seen_urls,
            location=location,
            target_new=max(5, target),
            max_pages=2,          # rapide : 2 pages max
            exclude_keywords=exclude_kw,
            start_offset=0,       # toujours page 1 pour les recents
            recent_days=3,
        )
        console.print(f" {len(found)} recentes")
        for j in found:
            k = job_key(j)
            if k:
                seen_urls.add(k)
                seen.add(k)
        quick_jobs.extend(found)
        time.sleep(0.5)

    quick_jobs = dedup_jobs(quick_jobs)
    if quick_jobs:
        console.print(f"  [green]{len(quick_jobs)} offres fraiches trouvees -- traitement prioritaire[/green]")
        for job in quick_jobs:
            if not process_one(job, "fresh"):
                break
        save_seen(seen, SEEN_FILE)
    else:
        console.print(f"  [dim]Rien de frais -- passage a la routine normale[/dim]")

    # ── Niche pass : requetes de niche, toujours executees ───────────────────
    if niche_queries and not should_stop_hunt():
        console.print(f"\n[bold magenta]-- Niche pass ({len(niche_queries)} requetes) --[/bold magenta]")
        niche_jobs: list = []
        for q in niche_queries:
            if len(niche_jobs) >= target * 2:
                break
            cached = starts.get(f"niche:{q}")
            start_offset = cached if cached is not None else random.randint(0, 3) * 25
            console.print(f"  [{platform_label}/niche] -> [italic]{q}[/italic] [dim](start={start_offset})[/dim]", end="")
            found, next_start = scraper.search_new(
                q,
                seen=seen_urls,
                location=location,
                target_new=max(5, target),
                max_pages=4,
                exclude_keywords=exclude_kw,
                start_offset=start_offset,
            )
            starts[f"niche:{q}"] = next_start
            starts_file.write_text(json.dumps(starts, ensure_ascii=False, indent=2), encoding="utf-8")
            console.print(f" {len(found)} nouvelles")
            for j in found:
                k = job_key(j)
                if k:
                    seen_urls.add(k)
                    seen.add(k)
            niche_jobs.extend(found)
            time.sleep(0.8)

        niche_jobs = dedup_jobs(niche_jobs)
        if niche_jobs:
            console.print(f"  [magenta]{len(niche_jobs)} offres niche a analyser[/magenta]")
            save_seen(seen, SEEN_FILE)
            for job in niche_jobs:
                if not process_one(job, "niche"):
                    break
        else:
            console.print(f"  [dim]Rien de nouveau en niche aujourd'hui[/dim]")

    # ── Routine normale : tiers complets avec pagination memorisee ────────────
    for tier_num, queries in enumerate(tiers, 1):
        if should_stop_hunt():
            break

        console.print(f"\n[bold]-- Tier {tier_num}/{len(tiers)} : {', '.join(queries[:3])}... --[/bold]")

        for q in queries:
            if should_stop_hunt():
                break
            progress = qualified if find_only else generated
            remaining = max(0, target - progress)
            needed = min(max(3, remaining * 2), 12)
            cached = starts.get(q)
            start_offset = cached if cached is not None else random.randint(0, 5) * 25
            console.print(f"  [{platform_label}] -> [italic]{q}[/italic] [dim](start={start_offset})[/dim]")

            found, next_start = scraper.search_new(
                q,
                seen=seen_urls,
                location=location,
                target_new=needed,
                max_pages=8,
                exclude_keywords=exclude_kw,
                start_offset=start_offset,
            )

            starts[q] = next_start
            starts_file.write_text(json.dumps(starts, ensure_ascii=False, indent=2), encoding="utf-8")

            console.print(f"  {len(found)} nouvelles offres")
            for j in found:
                k = job_key(j)
                if k:
                    seen_urls.add(k)
                    seen.add(k)
            save_seen(seen, SEEN_FILE)

            for job in dedup_jobs(found):
                if not process_one(job):
                    break

            time.sleep(1)

    result = qualified if find_only else generated
    label = f"offre(s) ≥{min_score}/10" if find_only else f"candidature(s) {platform_label} generee(s)"
    status = "OK" if result >= target else "partiel"
    console.print(f"\n[bold][{status}] {result}/{target} {label}[/bold]")
    if analysis_cap_reached():
        console.print(
            f"[yellow]Plafond atteint : {max_analyzed} offres analysees sans assez de fit ≥{min_score}/10.[/yellow]"
        )
        console.print("[dim]Ajustez vos criteres de recherche dans le dashboard.[/dim]")
    elif result < target:
        console.print("[dim]Tous les tiers de requetes ont ete epuises.[/dim]")

    if open_dashboard and not find_only:
        dashboard_path = BASE_DIR / "dashboard.html"
        generate_dashboard(jobs, output_dir, dashboard_path)
        _ensure_state_server()
        console.print(f"\n[cyan]Dashboard -> {DASHBOARD_URL}[/cyan]")
        import subprocess as _sp
        try:
            _sp.run(["open", "-a", "Google Chrome", DASHBOARD_URL], check=True)
        except Exception:
            webbrowser.open(DASHBOARD_URL)


    return result


# -- Chasse sans generation (dashboard : garantir N offres >= min_score) -------

@cli.command("hunt-fill")
@click.option("--target", default=5, type=int, help="Nombre d'offres >= min-score a trouver")
@click.option("--min-score", default=6, type=int)
@click.option("--max-analyzed", default=0, type=int, help="Plafond d'analyses si objectif non atteint (0 = illimite)")
@click.option("--location", "-l", default="Paris")
@click.option("--query", "-q", multiple=True, help="Requetes prioritaires (profil utilisateur)")
@click.option("--no-dashboard", is_flag=True)
def hunt_fill(target, min_score, max_analyzed, location, query, no_dashboard):
    """Scrape pagine + analyse jusqu'a N offres >= min_score (sans generer de CV)."""
    config = load_config(CONFIG_FILE)
    api_key = get_api_key(config)
    model = config.get("anthropic", {}).get("model", "claude-opus-4-6")
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")
    output_dir.mkdir(parents=True, exist_ok=True)

    user_tier = list(dict.fromkeys(query)) if query else []
    uid = os.environ.get("JA_USER_ID")

    if uid:
        from search_queries import hunt_tiers_for_user
        tiers, niche_queries = hunt_tiers_for_user(uid, api_key, user_tier)
        if not tiers:
            tiers = [user_tier] if user_tier else []
        console.print(f"[dim]Mode profil — {len(tiers[0]) if tiers else 0} requêtes + {len(niche_queries)} niche(s) IA[/dim]")
    else:
        tiers = ([user_tier] if user_tier else []) + list(_HUNT_TIERS)
        niche_queries = _HUNT_NICHE

    if not tiers:
        tiers = _HUNT_TIERS
        if not uid:
            niche_queries = _HUNT_NICHE

    console.print(f"\n[bold cyan]Hunt-fill -- cible : {target} offres >= {min_score}/10[/bold cyan]\n")
    _run_hunt(
        scraper=LinkedInScraper(),
        tiers=tiers,
        starts_file=BASE_DIR / "linkedin_starts.json",
        platform_label="LinkedIn",
        target=target,
        min_score=min_score,
        location=location,
        config=config,
        api_key=api_key,
        model=model,
        output_dir=output_dir,
        open_dashboard=not no_dashboard,
        niche_queries=niche_queries,
        find_only=True,
        max_analyzed=max_analyzed,
    )


# -- Commande hunt LinkedIn --------------------------------------------------

@cli.command()
@click.option("--target", default=0, type=int, help="Nombre de candidatures (0 = demander)")
@click.option("--min-score", default=6, type=int)
@click.option("--location", default="Paris")
@click.option("--no-dashboard", is_flag=True)
def hunt(target, min_score, location, no_dashboard):
    """Chasse LinkedIn intelligente -- pagine et elargit les criteres auto."""
    config = load_config(CONFIG_FILE)
    api_key = get_api_key(config)
    model = config.get("anthropic", {}).get("model", "claude-opus-4-6")
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")
    output_dir.mkdir(parents=True, exist_ok=True)

    if target <= 0:
        try:
            raw = input("Combien de nouvelles candidatures LinkedIn a trouver ? ").strip()
            target = int(raw) if raw else 5
        except (ValueError, EOFError):
            target = 5

    console.print(f"\n[bold cyan]LinkedIn Hunt -- cible : {target} >= {min_score}/10[/bold cyan]\n")
    _run_hunt(
        scraper=LinkedInScraper(),
        tiers=_HUNT_TIERS,
        starts_file=BASE_DIR / "linkedin_starts.json",
        platform_label="LinkedIn",
        target=target,
        min_score=min_score,
        location=location,
        config=config,
        api_key=api_key,
        model=model,
        output_dir=output_dir,
        open_dashboard=not no_dashboard,
        niche_queries=_HUNT_NICHE,
    )


# -- Commande hunt-pme -------------------------------------------------------

@cli.command("hunt-pme")
@click.option("--target", default=0, type=int, help="Nombre de candidatures (0 = demander)")
@click.option("--min-score", default=6, type=int)
@click.option("--location", default="Paris")
@click.option("--no-dashboard", is_flag=True)
def hunt_pme(target, min_score, location, no_dashboard):
    """Chasse LinkedIn ciblée PME/ETI -- intitulés métier français, moins startup."""
    config = load_config(CONFIG_FILE)
    api_key = get_api_key(config)
    model = config.get("anthropic", {}).get("model", "claude-opus-4-6")
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")
    output_dir.mkdir(parents=True, exist_ok=True)

    if target <= 0:
        try:
            raw = input("Combien de nouvelles candidatures PME à trouver ? ").strip()
            target = int(raw) if raw else 5
        except (ValueError, EOFError):
            target = 5

    console.print(f"\n[bold magenta]🏭 PME Hunt -- cible : {target} >= {min_score}/10[/bold magenta]")
    console.print(f"   Scope : PME/ETI/industrie, intitulés métier français\n")
    _run_hunt(
        scraper=LinkedInScraper(),
        tiers=_HUNT_PME_TIERS,
        starts_file=BASE_DIR / "linkedin_pme_starts.json",
        platform_label="LinkedIn/PME",
        target=target,
        min_score=min_score,
        location=location,
        config=config,
        api_key=api_key,
        model=model,
        output_dir=output_dir,
        open_dashboard=not no_dashboard,
        niche_queries=_HUNT_PME_NICHE,
        pme_mode=True,
    )


# -- Commande hunt-indeed ----------------------------------------------------

@cli.command("hunt-indeed")
@click.option("--target", default=0, type=int, help="Nombre de candidatures (0 = demander)")
@click.option("--min-score", default=6, type=int)
@click.option("--location", default="Paris")
@click.option("--no-dashboard", is_flag=True)
def hunt_indeed(target, min_score, location, no_dashboard):
    """Chasse Indeed intelligente -- Playwright, pagine et elargit les criteres auto."""
    config = load_config(CONFIG_FILE)
    api_key = get_api_key(config)
    model = config.get("anthropic", {}).get("model", "claude-opus-4-6")
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")
    output_dir.mkdir(parents=True, exist_ok=True)

    if target <= 0:
        try:
            raw = input("Combien de nouvelles candidatures Indeed a trouver ? ").strip()
            target = int(raw) if raw else 5
        except (ValueError, EOFError):
            target = 5

    console.print(f"\n[bold cyan]Indeed Hunt -- cible : {target} >= {min_score}/10[/bold cyan]\n")
    scraper = IndeedScraper()
    scraper._ensure_browser()
    try:
        _run_hunt(
            scraper=scraper,
            tiers=INDEED_TIERS,
            starts_file=BASE_DIR / "indeed_starts.json",
            platform_label="Indeed",
            target=target,
            min_score=min_score,
            location=location,
            config=config,
            api_key=api_key,
            model=model,
            output_dir=output_dir,
            open_dashboard=not no_dashboard,
        )
    finally:
        scraper._close_browser()


# ============================================================================
# DASHBOARD
# ============================================================================

@cli.command()
@click.option("--open/--no-open", "open_browser", default=True)
def dashboard(open_browser):
    """Genere le dashboard HTML et l'ouvre dans le browser."""
    config = load_config(CONFIG_FILE)
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")
    jobs = load_jobs(JOBS_FILE)
    dashboard_path = BASE_DIR / "dashboard.html"
    generate_dashboard(jobs, output_dir, dashboard_path)
    _ensure_state_server()
    console.print(f"[bold green]Dashboard genere[/bold green] -> http://127.0.0.1:7433/")
    if open_browser:
        import subprocess as _sp
        try:
            _sp.run(["open", "-a", "Google Chrome", DASHBOARD_URL], check=True)
        except Exception:
            webbrowser.open(DASHBOARD_URL)


# ============================================================================
# SPONTANEOUS -- Candidatures spontanees startups WTTJ
# ============================================================================

@cli.command()
@click.option("--target", default=5, type=int)
@click.option("--min-score", default=6, type=int)
@click.option("--location", "-l", default="Paris")
@click.option("--dry-run", is_flag=True)
@click.option("--max-rounds", default=3, type=int)
def spontaneous(target, min_score, location, dry_run, max_rounds):
    """Genere des candidatures spontanees pour des startups tech Paris (WTTJ)."""
    config = load_config(CONFIG_FILE)
    api_key = get_api_key(config)
    cv_model = config.get("anthropic", {}).get("model", "claude-sonnet-4-6")  # CV : Sonnet
    analysis_model = ANALYSIS_MODEL  # Analyse + lettre : Haiku (économique)
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")
    output_dir.mkdir(parents=True, exist_ok=True)

    console.print(f"\n[bold cyan]Candidatures spontanees -- startups tech Paris[/bold cyan]")
    console.print(f"   Cible : {target} candidature(s), score >= {min_score}/10\n")

    applied = load_applied(APPLIED_FILE)
    gen = SpontaneousGenerator(api_key=api_key, model=analysis_model, cv_model=cv_model)
    results = []
    seen_slugs = {
        k.replace("spontaneous:wttj:", "")
        for k in applied if k.startswith("spontaneous:wttj:")
    }

    if dry_run:
        scraper = WTTJStartupScraper()
        companies = scraper.search_startups(max_companies=target * 4, location=location, skip_slugs=seen_slugs)
        scraper._close_browser()
        console.print(f"\n[bold]{len(companies)} nouvelles boites trouvees :[/bold]")
        for co in companies:
            console.print(f"  - {co.get('name', co.get('slug'))} [dim]({co.get('size','?')} emp.) -- {co.get('industry','')}[/dim]")
            if co.get("description"):
                console.print(f"    [dim]{co['description'][:100]}...[/dim]")
        return

    scraper = WTTJStartupScraper()
    round_num = 0

    while len(results) < target and round_num < max_rounds:
        round_num += 1
        needed = target - len(results)
        console.print(f"\n[dim]-- Round {round_num}/{max_rounds} ({needed} candidature(s) restante(s)) --[/dim]")

        companies = scraper.search_startups(max_companies=needed * 3, location=location, skip_slugs=seen_slugs)
        if not companies:
            console.print("[yellow]  Plus de nouvelles boites disponibles.[/yellow]")
            break

        for company in companies:
            if len(results) >= target:
                break

            slug = company.get("slug", "")
            name = company.get("name", slug or "?")
            key = f"spontaneous:wttj:{slug}"
            seen_slugs.add(slug)
            console.print(f"\n  [{len(results)+1}/{target}] {name}")

            if slug:
                console.print(f"[dim]  Verification page WTTJ...[/dim]", end="")
                if not scraper.is_alive(slug):
                    console.print(f" [red]page morte -- ignoree[/red]")
                    applied.add(key)
                    save_applied(applied, APPLIED_FILE)
                    seen_slugs.add(slug)
                    continue

                # Vérifie si candidature spontanée possible
                opts = scraper.check_apply_options(slug)
                if not opts["has_spontaneous"] and not opts["has_jobs"]:
                    console.print(f" [yellow]pas de bouton postuler -- ignoree[/yellow]")
                    applied.add(key)
                    save_applied(applied, APPLIED_FILE)
                    seen_slugs.add(slug)
                    continue
                console.print(f" [dim]OK (spontanée: {'oui' if opts['has_spontaneous'] else 'non'}, jobs: {'oui' if opts['has_jobs'] else 'non'})[/dim]")
                # Passe l'URL directe du bouton "Postuler spontanément" si disponible
                if opts.get("apply_url"):
                    company["apply_url"] = opts["apply_url"]

            if not company.get("description") and slug:
                console.print(f"[dim]  Chargement du profil...[/dim]")
                profile = scraper.get_company_profile(slug)
                company.update({k: v for k, v in profile.items() if v and not company.get(k)})

            result = gen.analyze_and_generate(company, output_dir, index=len(results) + 1)

            if result and result.get("fit_score", 0) >= min_score:
                results.append(result)
                applied.add(key)
                save_applied(applied, APPLIED_FILE)
                console.print(f"[green]  Candidature {len(results)}/{target}[/green]")
            elif result:
                score = result.get("fit_score", "?")
                console.print(f"[dim]  Score {score}/10 < {min_score} -> ignore[/dim]")

        if len(results) < target and round_num < max_rounds:
            console.print(f"\n[dim]  {len(results)}/{target} atteintes -- nouveau round...[/dim]")

    scraper._close_browser()

    if len(results) < target:
        console.print(f"\n[yellow]{len(results)}/{target} candidatures generees (WTTJ epuise ou scores trop faibles)[/yellow]")
    else:
        console.print(f"\n[bold green]{len(results)} candidature(s) spontanee(s) generee(s) ![/bold green]")

    for r in results:
        console.print(f"  {r['company']} -> {r['role']} [green]({r['fit_score']}/10)[/green]")

    jobs = load_jobs(JOBS_FILE)
    dashboard_path = BASE_DIR / "dashboard.html"
    generate_dashboard(jobs, output_dir, dashboard_path)
    _ensure_state_server()
    console.print(f"\n[cyan]Dashboard -> {DASHBOARD_URL}[/cyan]")
    import subprocess as _sp
    try:
        _sp.run(["open", "-a", "Google Chrome", DASHBOARD_URL], check=True)
    except Exception:
        webbrowser.open(DASHBOARD_URL)



# ============================================================================
# AUTOSUBMIT
# ============================================================================

@cli.command()
@click.option("--id", "job_id", default=None, type=int,
              help="Numéro de l'offre (colonne # du dashboard)")
@click.option("--train", "do_train", is_flag=True,
              help="Mode training : inspecte les formulaires sans rien soumettre")
@click.option("--last", default=5, type=int,
              help="Avec --train : nombre de candidatures récentes à inspecter")
@click.option("--auto-submit", "auto_submit", is_flag=True, default=False,
              help="Lance sans pause ni validation terminale à la fin")
def autosubmit(job_id, do_train, last, auto_submit):
    """Remplit automatiquement le formulaire de candidature (Playwright).

    \b
    Exemples :
      python main.py autosubmit --id 29       # remplit le formulaire Alan
      python main.py autosubmit --train        # inspecte les 5 dernières offres postulées
      python main.py autosubmit --train --last 10
    """
    config    = load_config(CONFIG_FILE)
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")

    # ── Mode training ──────────────────────────────────────────────────────
    if do_train:
        # On ne garde que les dossiers contenant job_info.json
        all_dirs  = [d for d in sorted(output_dir.glob("*/"), reverse=True) if (d / "job_info.json").exists()]
        urls = []
        for d in all_dirs:
            if len(urls) >= last:
                break
            try:
                data = json.loads((d / "job_info.json").read_text(encoding="utf-8"))
                url  = data.get("job", {}).get("url", "")
                if url:
                    company = data.get("job", {}).get("company", d.name)
                    urls.append((company, url))
            except Exception:
                pass

        if not urls:
            console.print("[yellow]Aucune candidature trouvée pour le training.[/yellow]")
            return

        console.print(f"\n[bold cyan]Training sur {len(urls)} candidature(s) récentes :[/bold cyan]")
        for company, url in urls:
            ats = detect_ats(url)
            console.print(f"  {company:30} [{ats}] {url[:55]}")

        filler = AutoFiller(headless=False)
        filler.train([url for _, url in urls])
        return

    # ── Mode remplissage ───────────────────────────────────────────────────
    if not job_id:
        console.print("[yellow]Précise --id N (numéro de l'offre) ou --train[/yellow]")
        console.print("  Ex: python main.py autosubmit --id 29")
        return

    # Cherche le dossier de candidature correspondant
    candidates = sorted(output_dir.glob(f"{job_id:03d}_*/"))
    if not candidates:
        candidates = sorted(output_dir.glob(f"{job_id}_*/"))
    # Accepte job_info.json (offres normales + spontanées récentes) OU resume.txt (spontanées legacy)
    valid = [d for d in candidates if (d / "job_info.json").exists() or (d / "resume.txt").exists()]
    if not valid:
        if candidates:
            console.print(f"[yellow]{len(candidates)} dossier(s) trouvé(s) pour l'id {job_id} mais aucun ne contient job_info.json ou resume.txt.[/yellow]")
        else:
            console.print(f"[red]Aucun dossier de candidature trouvé pour l'id {job_id}[/red]")
        # Liste les ids disponibles
        valid_ids = []
        for d in sorted(output_dir.glob('*/')):
            if not (d / 'job_info.json').exists() and not (d / 'resume.txt').exists():
                continue
            m = re.match(r'^(\d+)_', d.name)
            if m:
                valid_ids.append(int(m.group(1)))
        if valid_ids:
            sample = sorted(set(valid_ids))[:10]
            console.print(f"   Ids dispo : {sample} ... ({len(valid_ids)} au total)")
        return

    app_dir = valid[0]
    console.print(f"\n[bold]Candidature :[/bold] {app_dir.name}")

    # Charge les données — job_info.json prioritaire, sinon parse resume.txt (candidatures spontanées legacy)
    job_info_path = app_dir / "job_info.json"
    if job_info_path.exists():
        data = json.loads(job_info_path.read_text(encoding="utf-8"))
        job  = data.get("job", {})
    else:
        # Candidature spontanée sans job_info.json : parse resume.txt
        resume_path = app_dir / "resume.txt"
        resume_text = resume_path.read_text(encoding="utf-8")
        url_line = next((l for l in resume_text.splitlines() if l.startswith("URL WTTJ")), "")
        company_line = next((l for l in resume_text.splitlines() if l.startswith("Entreprise")), "")
        role_line = next((l for l in resume_text.splitlines() if l.startswith("Rôle ciblé")), "")
        job = {
            "url":     url_line.split(":", 1)[-1].strip() if url_line else "",
            "company": company_line.split(":", 1)[-1].strip() if company_line else app_dir.name,
            "title":   role_line.split(":", 1)[-1].strip() if role_line else "Candidature spontanée",
            "type":    "spontaneous",
            "source":  "wttj",
        }
        data = {"job": job}

    # Trouve le CV PDF
    cv_files = sorted(app_dir.glob("*.pdf"))
    cv_path  = cv_files[0] if cv_files else None
    if cv_path:
        console.print(f"  CV    : {cv_path.name}")
    else:
        console.print("  [yellow]Pas de CV PDF trouvé dans ce dossier[/yellow]")

    # Trouve la lettre .txt
    letter_text = ""
    txt_files = sorted(app_dir.glob("LettreMotivation_*.txt"))
    if txt_files:
        letter_text = txt_files[0].read_text(encoding="utf-8").strip()
        console.print(f"  Lettre: {txt_files[0].name} ({len(letter_text)} chars)")
    else:
        console.print("  [yellow]Pas de lettre trouvée[/yellow]")

    url = job.get("url", "")
    if not url:
        console.print("[red]Pas d'URL dans job_info.json[/red]")
        return

    console.print(f"  URL   : {url[:80]}")
    console.print(f"  ATS   : [cyan]{detect_ats(url)}[/cyan]")
    console.print(f"\n[dim]Le navigateur va s'ouvrir. Claude va analyser et remplir les champs.[/dim]")
    console.print(f"[dim]Tu garderas la main pour le Submit final.[/dim]\n")

    # Récupère clé API. Mapping de champs → Haiku (économique, suffisant)
    config   = load_config(CONFIG_FILE)
    api_key  = get_api_key(config)
    model    = AUTOFILL_MODEL

    if not api_key:
        console.print("[red]Clé Anthropic manquante dans config.yaml[/red]")
        return

    import shutil
    filler = AutoFiller(headless=False)
    ok = filler.smart_fill(job, cv_path or Path(""), letter_text,
                           api_key=api_key, model=model, app_dir=app_dir,
                           auto_submit=auto_submit, pause=not auto_submit)

    # WTTJ spontanée sans formulaire → supprime le dossier et régénère le dashboard
    if not ok and filler._no_spontaneous_form:
        console.print(f"\n[yellow]→ Suppression de la candidature {app_dir.name} (pas de formulaire WTTJ)[/yellow]")
        try:
            shutil.rmtree(app_dir)
            console.print(f"[green]  ✓ Dossier supprimé[/green]")
        except Exception as e:
            console.print(f"[red]  Erreur suppression : {e}[/red]")
        # Régénère le dashboard
        try:
            jobs_data = load_jobs(JOBS_FILE)
            generate_dashboard(jobs_data, output_dir, BASE_DIR / "dashboard.html")
            console.print(f"[green]  ✓ Dashboard régénéré[/green]")
        except Exception as e:
            console.print(f"[yellow]  Dashboard non régénéré : {e}[/yellow]")


# ============================================================================
# AUTO-APPLY -- Soumission automatique des candidatures avec fit_score >= seuil
# ============================================================================

USER_STATE_FILE = BASE_DIR / "user_state.json"


def _load_user_state():
    if USER_STATE_FILE.exists():
        try:
            data = json.loads(USER_STATE_FILE.read_text(encoding="utf-8"))
            if not isinstance(data.get("applied"), dict):
                data["applied"] = {}
            if not isinstance(data.get("deleted"), list):
                data["deleted"] = []
            if not isinstance(data.get("auto_failed"), dict):
                data["auto_failed"] = {}
            return data
        except Exception:
            pass
    return {"applied": {}, "deleted": [], "auto_failed": {}}


def _save_user_state(state):
    USER_STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _dashboard_id(company: str, title: str) -> str:
    """Reproduit le format d'id utilisé par le dashboard pour les checkboxes."""
    return f"{company}|{title}".replace("'", "").replace('"', "")


def _normalize_id(s: str) -> str:
    """Normalisation agressive pour matcher entre jobs.json et job_info.json
    (différences de casse, espaces, accents, ponctuation)."""
    if not s:
        return ""
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9|]+", "", s.lower())


def _pipeline_emit(msg: str, progress: int | None = None) -> None:
    """Envoie une ligne + progression au dashboard (mode auto-apply web)."""
    run_id = os.environ.get("JA_RUN_ID")
    if not run_id:
        return
    try:
        from store import pipeline_log, pipeline_set_status
        pipeline_log(run_id, msg)
        if progress is not None:
            pipeline_set_status(run_id, "running", progress=progress)
    except Exception:
        pass


@cli.command("auto-apply")
@click.option("--min-score", default=6, type=int,
              help="Score minimum (défaut : 6)")
@click.option("--max", "max_apps", default=20, type=int,
              help="Maximum de candidatures à processer dans cette run")
@click.option("--ids", default="", help="IDs spécifiques (ex: 1,3,5) pour limiter la sélection")
@click.option("--no-dashboard", is_flag=True)
@click.option("--recent-only", is_flag=True, default=False,
              help="Dashboard : uniquement les offres avec CV+lettre générés lors de la dernière recherche")
def auto_apply(min_score, max_apps, ids, no_dashboard, recent_only):
    """Mode batch one-by-one : ouvre, remplit, attend ta validation manuelle.

    \b
    Pour chaque candidature ≥ seuil :
      1. Ouvre le formulaire dans le navigateur
      2. Remplit les champs (Claude Sonnet)
      3. PAUSE — la fenêtre reste ouverte avec le form rempli
      4. Tu reviewes, cliques Submit toi-même (humain → pas de bot detection)
      5. Tu reviens ici, tu réponds o/n/s/q
      6. Passe à la suivante
    """
    config    = load_config(CONFIG_FILE)
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")
    api_key   = get_api_key(config)
    model     = AUTOFILL_MODEL  # Sonnet pour la qualité du mapping

    if not api_key:
        console.print("[red]Clé Anthropic manquante[/red]")
        return

    # Filtre IDs si fourni
    id_filter = set()
    if ids.strip():
        for s in ids.split(","):
            s = s.strip()
            if s.isdigit():
                id_filter.add(int(s))

    state = _load_user_state()
    uid = os.environ.get("JA_USER_ID")

    candidates = []
    skipped_wttj = 0
    skipped_done = 0
    skipped_del = 0
    skipped_no_docs = 0

    if uid and not id_filter:
        env_urls = os.environ.get("JA_AUTOAPPLY_URLS", "").strip()
        explicit_urls = (
            [u.strip() for u in env_urls.split(",") if u.strip()] if env_urls else None
        )
        if explicit_urls:
            recent_urls = explicit_urls
            console.print(
                f"[dim]→ Sélection dashboard : {len(recent_urls)} offre(s)[/dim]"
            )
        elif recent_only:
            recent_urls = recent_generated_urls(uid)
            if not recent_urls:
                console.print(
                    "[yellow]Aucune candidature générée lors de la dernière recherche. "
                    "Lancez d'abord « Lancer la recherche ».[/yellow]"
                )
                return
            console.print(
                f"[dim]→ Filtre récent : {len(recent_urls)} offre(s) avec CV+lettre générés[/dim]"
            )
        else:
            recent_urls = None
        ready = list_autoapply_jobs(uid, min_score=min_score, recent_urls=recent_urls)
        if not ready and recent_urls:
            console.print(
                "[yellow]Aucune offre prête correspondant à la sélection.[/yellow]"
            )
            try:
                res = (
                    supabase_client()
                    .table("jobs")
                    .select("url,cv_url,letter_url,fit_score,data,applied")
                    .eq("user_id", uid)
                    .eq("deleted", False)
                    .execute()
                )
                all_rows = res.data or []
            except Exception:
                all_rows = []
            for sel in recent_urls[:5]:
                match = next(
                    (r for r in all_rows if _urls_overlap(r.get("url") or "", sel)),
                    None,
                )
                if not match:
                    console.print(f"  [dim]· {sel[:72]} → introuvable en base[/dim]")
                    continue
                score = _coerce_fit_score(match)
                cv = "✓" if match.get("cv_url") else "✗"
                lt = "✓" if match.get("letter_url") else "✗"
                console.print(
                    f"  [dim]· score={score}/10 · cv={cv} · lettre={lt} · "
                    f"envoyée={bool(match.get('applied'))}[/dim]"
                )
            return
        if not ready:
            console.print(
                "[yellow]Aucune offre prête (CV + lettre, score ≥ "
                f"{min_score}/10, non envoyée).[/yellow]"
            )
            return
        for row in ready:
            data = row.get("data") or {}
            company = (data.get("company") or "").strip()
            title = (data.get("title") or "").strip()
            url = (row.get("url") or "").strip()
            if not company or not url:
                continue
            if "welcometothejungle" in url.lower() or detect_ats(url) == "wttj":
                skipped_wttj += 1
                continue
            app_dir, cv_path, letter_text = ensure_local_docs(row, output_dir)
            if not cv_path or not cv_path.exists() or not letter_text:
                skipped_no_docs += 1
                continue
            dash_id = _dashboard_id(company, title)
            candidates.append({
                "dir": app_dir,
                "info": {"job": data, "fit_score": row.get("fit_score")},
                "job": {**data, "url": url},
                "dash_id": dash_id,
                "score": row.get("fit_score") or 0,
                "cv_path": cv_path,
                "letter_text": letter_text,
            })
    else:
        # ── Mode CLI local : dossiers applications/ (legacy) ─────────────────
        jobs = load_jobs(JOBS_FILE)
        score_by_key = {}
        for j in jobs:
            c = (j.get("company") or "").lower().strip()
            t = (j.get("title") or "").lower().strip()
            if c and t:
                score_by_key[f"{c}|{t}"] = j.get("fit_score") or j.get("_fit_score") or 0

        deleted_idxs = set()
        deleted_norms = set()
        for x in state.get("deleted", []):
            try:
                deleted_idxs.add(int(x))
            except (ValueError, TypeError):
                deleted_norms.add(_normalize_id(str(x)))

        applied_norm = {_normalize_id(k) for k in state["applied"].keys()}
        applied_urls = set()
        for v in state["applied"].values():
            if isinstance(v, dict) and v.get("url"):
                applied_urls.add(v["url"].rstrip("/"))

        for d in sorted(output_dir.glob("*/")):
            ji = d / "job_info.json"
            if not ji.exists():
                continue
            m = re.match(r"^(\d+)_", d.name)
            idx = int(m.group(1)) if m else 0
            if id_filter and idx not in id_filter:
                continue
            if idx in deleted_idxs:
                skipped_del += 1
                continue
            try:
                info = json.loads(ji.read_text(encoding="utf-8"))
            except Exception:
                continue
            job = info.get("job", {})
            company = (job.get("company") or "").strip()
            title = (job.get("title") or "").strip()
            url = (job.get("url") or "").strip()
            if not company or not url:
                continue
            if deleted_norms:
                dash_norm = _normalize_id(_dashboard_id(company, title))
                if dash_norm in deleted_norms:
                    skipped_del += 1
                    continue
            if "welcometothejungle" in url.lower() or detect_ats(url) == "wttj":
                skipped_wttj += 1
                continue
            score_key = f"{company.lower()}|{title.lower()}"
            score = info.get("fit_score") or score_by_key.get(score_key, 0)
            if not id_filter and score < min_score:
                continue
            dash_id = _dashboard_id(company, title)
            norm = _normalize_id(dash_id)
            url_clean = url.rstrip("/")
            if norm in applied_norm or url_clean in applied_urls:
                skipped_done += 1
                continue
            cv_files = sorted(d.glob("*.pdf"))
            letter_text = ""
            for txt in sorted(d.glob("LettreMotivation_*.txt")):
                try:
                    letter_text = txt.read_text(encoding="utf-8").strip()
                    break
                except Exception:
                    pass
            if not cv_files or not letter_text:
                skipped_no_docs += 1
                continue
            candidates.append({
                "dir": d,
                "info": info,
                "job": job,
                "dash_id": dash_id,
                "score": score,
                "cv_path": cv_files[0],
                "letter_text": letter_text,
            })

    if skipped_del:
        console.print(f"[dim]→ {skipped_del} supprimée(s) du dashboard (skip)[/dim]")
    if skipped_wttj:
        console.print(f"[dim]→ {skipped_wttj} WTTJ ignorée(s) (à soumettre manuellement)[/dim]")
    if skipped_done:
        console.print(f"[dim]→ {skipped_done} déjà postulée(s) (skip)[/dim]")
    if skipped_no_docs:
        console.print(f"[dim]→ {skipped_no_docs} sans CV+lettre (skip)[/dim]")

    if not candidates:
        console.print("[yellow]Aucune candidature à processer.[/yellow]")
        return

    candidates = candidates[:max_apps]

    # ── Aperçu (pas de confirmation — lancé direct depuis la routine) ─────────
    console.print(f"\n[bold cyan]── {len(candidates)} candidature(s) à processer (mode fill-only) ──[/bold cyan]")
    _pipeline_emit(f"── Auto-apply : {len(candidates)} candidature(s) à processer ──", 12)
    for i, c in enumerate(candidates, 1):
        console.print(f"  {i}. {c['job'].get('company','?')[:25]:25} · {c['job'].get('title','?')[:42]:42} ({c['score']}/10)")
    console.print()

    fill_errors  = []
    success_count = 0

    # ── Un seul browser (profil persistant = session LinkedIn conservée),
    # un onglet par offre. Le bug "mauvais onglet" est corrigé dans
    # _switch_to_latest_page via le snapshot pages_before passé à chaque
    # _click_apply_button → jamais de confusion entre onglets déjà remplis.
    console.print(f"[bold]Remplissage : {len(candidates)} onglet(s) dans un seul Chromium[/bold]\n")

    filler = AutoFiller(headless=False)

    try:
        for i, c in enumerate(candidates, 1):
            d   = c["dir"]
            job = c["job"]
            company = job.get("company", "?")
            title = job.get("title", "?")
            fill_progress = int(12 + (i - 1) / len(candidates) * 75) if len(candidates) else 12
            _pipeline_emit(
                f"── Candidature {i}/{len(candidates)} : {company[:30]} · {title[:40]}",
                fill_progress,
            )
            console.print(f"\n[bold cyan]┌──────────────────────────────────────────────────────────────┐[/bold cyan]")
            console.print(f"[bold cyan]│ ({i}/{len(candidates)}) {company[:25]:25} · {title[:30]:30} │[/bold cyan]")
            console.print(f"[bold cyan]└──────────────────────────────────────────────────────────────┘[/bold cyan]")

            cv_path = c.get("cv_path") or Path("")
            letter_text = c.get("letter_text") or ""
            if not letter_text:
                for txt in sorted(d.glob("LettreMotivation_*.txt")):
                    try:
                        letter_text = txt.read_text(encoding="utf-8").strip()
                        break
                    except Exception:
                        pass
            if not cv_path:
                cv_files = sorted(d.glob("*.pdf"))
                cv_path = cv_files[0] if cv_files else Path("")

            try:
                ok = filler.smart_fill(job, cv_path, letter_text,
                                       api_key=api_key, model=model,
                                       app_dir=d, auto_submit=False, pause=False)
                if ok:
                    ready_progress = int(12 + i / len(candidates) * 75) if len(candidates) else 85
                    _pipeline_emit(f"✓ Onglet {i}/{len(candidates)} prêt", ready_progress)
                    console.print(f"[bold green]   ✓ Onglet {i} prêt, clique « Envoyer la candidature »[/bold green]")
                    success_count += 1
                else:
                    console.print(f"[yellow]   ⚠ Offre {i} ignorée (compte requis / pas de form / skip)[/yellow]")
                    fill_errors.append((i, c, "smart_fill returned False"))
            except Exception as e:
                console.print(f"[red]   ✗ Exception : {str(e)[:120]}[/red]")
                fill_errors.append((i, c, str(e)[:200]))

            if i < len(candidates):
                console.print(f"[dim]   → Onglet suivant dans 2s...[/dim]")
                time.sleep(2)

        if fill_errors:
            console.print(f"\n[yellow]⚠ {len(fill_errors)} candidature(s) ignorée(s)/en erreur :[/yellow]")
            for idx, c, err in fill_errors:
                reason = err if err != "smart_fill returned False" else "compte requis / pas de form"
                console.print(f"  {idx}. {c['job'].get('company','?')} — {reason[:80]}")

        console.print(f"\n[bold green]✅ {success_count}/{len(candidates)} onglet(s) prêt(s)[/bold green]")
        _pipeline_emit(f"\n✅ {success_count}/{len(candidates)} onglet(s) prêt(s)", 95)
        console.print(f"[bold]→ Va sur chaque onglet Chromium et clique Submit.[/bold]")
        _pipeline_emit("→ Va sur chaque onglet Chromium et clique Submit.", 98)
        console.print(f"[dim]   Coche ensuite ✅ Soumis dans le dashboard pour tracker.[/dim]")

        # Régénère le dashboard + ouvre dans Chrome
        if not no_dashboard and not uid:
            try:
                jobs = load_jobs(JOBS_FILE)
                generate_dashboard(jobs, output_dir, BASE_DIR / "dashboard.html")
                console.print(f"[green]  ✓ Dashboard régénéré[/green]")
                _ensure_state_server()
                import subprocess as _sp
                try:
                    _sp.run(["open", "-a", "Google Chrome", DASHBOARD_URL], check=True)
                except Exception:
                    webbrowser.open(DASHBOARD_URL)
                console.print(f"[cyan]  → Dashboard ouvert dans Chrome sur {DASHBOARD_URL}[/cyan]")
            except Exception as e:
                console.print(f"[yellow]  Dashboard : {e}[/yellow]")

        # ── Garde le browser ouvert jusqu'à ce que tu aies tout soumis ───────
        if success_count > 0:
            console.print(f"\n[bold yellow]⏳ Chromium reste ouvert, passe sur chaque onglet et clique Submit.[/bold yellow]")
            if sys.stdin.isatty():
                console.print(f"[bold yellow]   Quand tout est soumis, appuie sur Entrée ici pour fermer.[/bold yellow]")
                try:
                    input()
                except (EOFError, KeyboardInterrupt):
                    pass
            else:
                # Lancé depuis le dashboard web : pas de stdin → on garde Chromium
                # ouvert tant que des onglets existent (fermeture manuelle), max 45 min.
                console.print(f"[bold yellow]   Ferme la fenêtre Chromium quand tu as tout soumis.[/bold yellow]")
                _pipeline_emit("Ferme la fenêtre Chromium quand tu as tout soumis.", 100)
                deadline = time.time() + 45 * 60
                while time.time() < deadline:
                    try:
                        if not filler._browser:
                            break
                        pages = [p for p in filler._browser.pages if not p.is_closed()]
                        if not pages:
                            break
                    except Exception:
                        break
                    time.sleep(2)
                _pipeline_emit("\n✅ Auto-apply terminé.", 100)

    finally:
        filler._close()


# ============================================================================
# QUICK-APPLY : postuler depuis une URL directement
# ============================================================================

def _scrape_job_from_url(url: str) -> dict:
    """
    Scrape titre, entreprise et description depuis une URL d'offre.
    Supporte LinkedIn, WTTJ, et la plupart des ATS génériques.
    """
    import requests
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return {"title": "", "company": "", "description": "", "error": "beautifulsoup4 manquant"}

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    }
    result = {"title": "", "company": "", "description": "", "error": ""}

    try:
        resp = requests.get(url, headers=headers, timeout=20)
        soup = BeautifulSoup(resp.text, "lxml")

        if "linkedin.com" in url:
            title_el = soup.select_one(
                "h1.top-card-layout__title, h1.topcard__title, h2.top-card-layout__title, h1"
            )
            company_el = soup.select_one(
                "a.topcard__org-name-link, span.topcard__org-name, "
                "a.top-card-layout__card-name-link, [class*='company-name']"
            )
            desc_el = soup.select_one(
                ".show-more-less-html__markup, .description__text, [class*='description']"
            )
            result["title"]       = title_el.get_text(strip=True) if title_el else ""
            result["company"]     = company_el.get_text(strip=True) if company_el else ""
            result["description"] = desc_el.get_text(separator="\n", strip=True) if desc_el else ""
            if not result["title"] and soup.title:
                result["title"] = soup.title.get_text().split(" at ")[0].split(" | ")[0].strip()
            if not result["company"] and soup.title:
                parts = soup.title.get_text().split(" at ")
                if len(parts) > 1:
                    result["company"] = parts[-1].split("|")[0].strip()

        elif "welcometothejungle.com" in url:
            title_el   = soup.select_one("h1")
            company_el = soup.select_one("h2, [class*='company-name'], [data-testid='company-name']")
            desc_el    = soup.select_one("article, [data-testid='job-description'], main")
            result["title"]       = title_el.get_text(strip=True) if title_el else ""
            result["company"]     = company_el.get_text(strip=True) if company_el else ""
            result["description"] = desc_el.get_text(separator="\n", strip=True)[:6000] if desc_el else ""
            if not result["company"] and soup.title:
                pt = soup.title.get_text()
                result["company"] = pt.split("|")[-1].strip() if "|" in pt else ""

        else:
            title_el = soup.select_one("h1")
            result["title"] = title_el.get_text(strip=True) if title_el else (
                soup.title.get_text().split("|")[0].strip() if soup.title else ""
            )
            if soup.title and "|" in soup.title.get_text():
                result["company"] = soup.title.get_text().split("|")[-1].strip()
            for sel in ["article", "main", "#content", ".job-description",
                        "[class*='description']", "[class*='content']", "body"]:
                el = soup.select_one(sel)
                if el and len(el.get_text()) > 200:
                    result["description"] = el.get_text(separator="\n", strip=True)[:6000]
                    break

    except Exception as e:
        result["error"] = str(e)

    return result


@cli.command("quick-apply")
@click.option("--url", required=True, help="URL de l'offre (LinkedIn, WTTJ, ATS...)")
@click.option("--auto-submit", is_flag=True, default=False,
              help="Soumet automatiquement sans pause (défaut: non)")
def quick_apply(url, auto_submit):
    """
    Postuler depuis une URL directement — sans générer de CV ni lettre.
    Ouvre le formulaire, le remplit avec l'IA, et s'arrête pour que tu valides.
    La session LinkedIn est conservée entre les runs (profil persistant).
    """
    config     = load_config(CONFIG_FILE)
    api_key    = get_api_key(config)
    output_dir = BASE_DIR / config.get("application", {}).get("output_dir", "applications")

    ats = detect_ats(url)
    console.print(f"\n[bold cyan]🔗 Quick-apply — {ats.upper()}[/bold cyan]")
    console.print(f"[dim]{url[:90]}[/dim]\n")

    # ── 1. Scrape offre ──────────────────────────────────────────────────────
    console.print("[dim]  Récupération de l'offre...[/dim]", end="")
    scraped = _scrape_job_from_url(url)
    if scraped.get("error") and not scraped.get("title"):
        console.print(f" [yellow]⚠ {scraped['error'][:80]}[/yellow]")

    title   = scraped.get("title", "").strip()
    company = scraped.get("company", "").strip()
    desc    = scraped.get("description", "").strip()

    if not title:
        title   = click.prompt("  Titre du poste").strip()
    if not company:
        company = click.prompt("  Nom de l'entreprise").strip()

    console.print(f" [green]✓[/green] [bold]{company}[/bold] — {title[:60]}")

    job = {
        "title":       title,
        "company":     company,
        "url":         url,
        "description": desc,
        "platform":    ats,
        "source":      ats,
    }

    # ── 2. Sauvegarde minimale + dossier ─────────────────────────────────────
    jobs      = load_jobs(JOBS_FILE)
    job["_fit_score"] = 0
    jobs_dedup = [j for j in jobs if job_key(j) != job_key(job)]
    jobs_dedup.append(job)
    for i, j in enumerate(jobs_dedup):
        j["_idx"] = i + 1
    save_jobs(jobs_dedup, JOBS_FILE)

    idx     = job.get("_idx", len(jobs_dedup))
    app_dir = make_app_dir(output_dir, idx, company, title)

    (app_dir / "job_info.json").write_text(json.dumps({
        "job": {k: v for k, v in job.items() if not k.startswith("_")},
        "fit_score": 0,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── 3. PDF vide (placeholder — pas de vrai CV généré) ────────────────────
    company_slug = re.sub(r"[^A-Za-z0-9_-]", "", company.replace(" ", "_"))[:20] or "Entreprise"
    cv_path = app_dir / f"{company_slug}.pdf"
    _pdf_bytes = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n"
        b"0000000052 00000 n\n0000000101 00000 n\n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n173\n%%EOF"
    )
    cv_path.write_bytes(_pdf_bytes)
    console.print(f"  [dim]📄 PDF placeholder : {cv_path.name}[/dim]")

    # Lettre = texte minimal (pas générée)
    letter_text = "exemple exemple"

    # ── 4. Auto-apply ────────────────────────────────────────────────────────
    console.print(f"\n[bold]  Ouverture du formulaire...[/bold]")
    console.print(f"  [dim]auto_submit={'oui' if auto_submit else 'non — tu cliques Submit'}[/dim]\n")

    filler = AutoFiller(headless=False)
    try:
        ok = filler.smart_fill(
            job, cv_path, letter_text,
            api_key=api_key, model=AUTOFILL_MODEL,
            app_dir=app_dir,
            auto_submit=auto_submit,
            pause=not auto_submit,
        )
    finally:
        filler._close()

    # Dashboard
    try:
        jobs_data = load_jobs(JOBS_FILE)
        generate_dashboard(jobs_data, output_dir, BASE_DIR / "dashboard.html")
    except Exception:
        pass

    status = "[green]✅ OK[/green]" if ok else "[yellow]⚠ Partiel[/yellow]"
    console.print(f"\n{status}  {company} — {title[:50]}")


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    cli()
