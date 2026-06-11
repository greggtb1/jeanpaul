"""Utilitaires partagés."""

import json
import os
import re
import yaml
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict, Optional


def slugify(text: str, max_len: int = 40) -> str:
    """Convertit un texte en slug safe pour les noms de dossiers."""
    text = text.strip().lower()
    text = re.sub(r"[àáâãäå]", "a", text)
    text = re.sub(r"[èéêë]", "e", text)
    text = re.sub(r"[ìíîï]", "i", text)
    text = re.sub(r"[òóôõö]", "o", text)
    text = re.sub(r"[ùúûü]", "u", text)
    text = re.sub(r"[ç]", "c", text)
    text = re.sub(r"[ñ]", "n", text)
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s-]+", "-", text)
    return text[:max_len].strip("-")


def load_jobs(jobs_file: Path, seen_file: Optional[Path] = None) -> List[Dict]:
    """Charge les offres depuis jobs.json. Repart de zéro si le fichier est corrompu.
    NOTE: seen.json n'est jamais supprimé ici — il contient les URLs des offres
    supprimées du dashboard et doit survivre à un reset de jobs.json."""
    if not jobs_file.exists():
        return []
    try:
        with open(jobs_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data or []
    except (json.JSONDecodeError, ValueError):
        print(f"⚠️  {jobs_file.name} corrompu — réinitialisation.")
        jobs_file.rename(jobs_file.with_suffix(".backup.json"))
        return []


def save_jobs(jobs: List[Dict], jobs_file: Path):
    """Sauvegarde les offres dans jobs.json (strip les références circulaires)."""
    jobs_file.parent.mkdir(parents=True, exist_ok=True)
    clean = []
    for job in jobs:
        j = {k: v for k, v in job.items() if k != "raw"}
        if "_analysis" in j and isinstance(j["_analysis"], dict):
            # Supprime la référence circulaire job → _analysis → job
            j["_analysis"] = {k: v for k, v in j["_analysis"].items() if k != "job"}
        clean.append(j)
    with open(jobs_file, "w", encoding="utf-8") as f:
        json.dump(clean, f, ensure_ascii=False, indent=2)


def load_config(config_path: Path) -> Dict:
    """Charge la configuration YAML."""
    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def get_api_key(config: Dict) -> str:
    """Récupère la clé Anthropic depuis la config ou l'env."""
    key = config.get("anthropic", {}).get("api_key", "")
    if not key:
        key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        raise ValueError(
            "Clé Anthropic manquante !\n"
            "→ Mets ta clé dans config.yaml sous anthropic.api_key\n"
            "→ Ou définis la variable d'env ANTHROPIC_API_KEY"
        )
    return key


INTERNSHIP_TITLE_KEYWORDS = [
    "stage", "stagiaire", "alternance", "alternant", "apprenti", "apprentissage",
    "intern", "internship", "apprentice", "apprenticeship",
]


def _wants_internship(target_roles: List[str], contract_type: Optional[List[str]] = None) -> bool:
    """Renvoie True si l'utilisateur cherche explicitement un stage/alternance.

    Vérifie :
    - Les postes visés (target_roles) : "alternance product", "stagiaire", etc.
    - Le type de contrat sélectionné (contract_type) : ["Stage"], ["Alternance"], etc.
    """
    roles_lower = " ".join(target_roles).lower()
    if any(kw in roles_lower for kw in INTERNSHIP_TITLE_KEYWORDS):
        return True
    if contract_type:
        contracts_lower = " ".join(contract_type).lower()
        if any(kw in contracts_lower for kw in INTERNSHIP_TITLE_KEYWORDS):
            return True
    return False


def filter_jobs(jobs: List[Dict], config: Dict, target_roles: Optional[List[str]] = None,
                contract_type: Optional[List[str]] = None) -> List[Dict]:
    """Filtre les offres selon les règles de config.yaml.

    Si target_roles est fourni et ne contient pas de stage/alternance
    (ni dans contract_type), les offres dont le TITRE contient ces mots-clés
    sont automatiquement exclues.
    """
    filters = config.get("filters", {})
    exclude = [k.lower() for k in filters.get("exclude_keywords", [])]
    require = [k.lower() for k in filters.get("require_keywords", [])]

    block_internships = target_roles is not None and not _wants_internship(target_roles, contract_type)

    filtered = []
    for job in jobs:
        text = f"{job.get('title', '')} {job.get('description', '')}".lower()

        # Exclure si un mot interdit est présent dans le TITRE
        title_lower = job.get("title", "").lower()
        if any(ex in title_lower for ex in exclude):
            continue

        # Exclure les offres de stage/alternance si l'utilisateur n'en cherche pas
        if block_internships and any(kw in title_lower for kw in INTERNSHIP_TITLE_KEYWORDS):
            continue

        # Inclure seulement si mot requis présent (si liste non vide)
        if require and not any(req in text for req in require):
            continue

        filtered.append(job)

    return filtered


def dedup_jobs(jobs: List[Dict]) -> List[Dict]:
    """Déduplique les offres par URL ou (titre + entreprise)."""
    seen = set()
    unique = []
    for job in jobs:
        key = job.get("url") or f"{job.get('title', '')}|{job.get('company', '')}".lower()
        if key not in seen:
            seen.add(key)
            unique.append(job)
    return unique


# ── Mémoire persistante des offres déjà vues ────────────────────────────────

def load_seen(seen_file: Path) -> set:
    """Charge les URLs/clés des offres déjà scrapées."""
    if not seen_file.exists():
        return set()
    try:
        with open(seen_file, "r", encoding="utf-8") as f:
            return set(json.load(f))
    except (json.JSONDecodeError, ValueError):
        return set()


def save_seen(seen: set, seen_file: Path):
    """Sauvegarde les URLs/clés des offres déjà scrapées."""
    with open(seen_file, "w", encoding="utf-8") as f:
        json.dump(sorted(seen), f, ensure_ascii=False, indent=2)


def job_key(job: Dict) -> str:
    """Clé unique d'une offre (URL ou titre+entreprise)."""
    return job.get("url") or f"{job.get('title', '')}|{job.get('company', '')}".lower()


def filter_new_jobs(jobs: List[Dict], seen: set) -> List[Dict]:
    """Retourne seulement les offres pas encore dans seen."""
    return [j for j in jobs if job_key(j) not in seen]


def load_applied(applied_file: Path) -> set:
    """Charge les clés des offres pour lesquelles une candidature a été générée."""
    if not applied_file.exists():
        return set()
    try:
        with open(applied_file, "r", encoding="utf-8") as f:
            return set(json.load(f))
    except (json.JSONDecodeError, ValueError):
        return set()


def save_applied(applied: set, applied_file: Path):
    """Sauvegarde les clés des offres candidatées."""
    with open(applied_file, "w", encoding="utf-8") as f:
        json.dump(sorted(applied), f, ensure_ascii=False, indent=2)


def make_app_dir(base_dir: Path, index: int, company: str, title: str) -> Path:
    """Crée et retourne le dossier d'une candidature."""
    folder_name = f"{index:03d}_{slugify(company)}_{slugify(title)}"
    app_dir = base_dir / folder_name
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir


# ── Fraîcheur des offres ─────────────────────────────────────────────────────

def _parse_job_date(job: Dict):
    """Parse la date de publication d'un job. Retourne toujours un datetime UTC aware."""
    raw = job.get("published_at", "")
    if not raw:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        raw = str(raw).strip().replace("Z", "+00:00")
        if "T" in raw or "+" in raw or raw.count("-") >= 2:
            dt = datetime.fromisoformat(raw)
            # Force UTC si pas de timezone
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        # Timestamp unix
        return datetime.fromtimestamp(float(raw), tz=timezone.utc)
    except Exception:
        return datetime.min.replace(tzinfo=timezone.utc)


def sort_by_freshness(jobs: List[Dict]) -> List[Dict]:
    """Trie les offres par date de publication (les plus récentes en premier)."""
    return sorted(jobs, key=_parse_job_date, reverse=True)


def filter_by_age(jobs: List[Dict], max_days: int) -> List[Dict]:
    """Retire les offres publiées il y a plus de max_days jours.
    Les offres sans date sont conservées (on ne sait pas si elles sont vieilles).
    """
    if max_days <= 0:
        return jobs
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_days)
    result = []
    for job in jobs:
        pub = _parse_job_date(job)
        if pub == datetime.min.replace(tzinfo=timezone.utc):
            result.append(job)   # date inconnue → on garde
        elif pub >= cutoff:
            result.append(job)
    return result
