"""Utilitaires partagés."""

import json
import os
import re
import unicodedata
import yaml
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Dict, Optional, Set


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

# Stage uniquement (sans alternance)
STAGE_TITLE_KEYWORDS = [
    "stage", "stagiaire", "intern", "internship",
]

ALTERNANCE_TITLE_KEYWORDS = [
    "alternance", "alternant", "apprenti", "apprentissage", "apprentice", "apprenticeship",
]

FREELANCE_TITLE_KEYWORDS = [
    "freelance", "freelancer", "indépendant", "independant", "mission freelance",
    "portage salarial", "consultant indépendant", "consultant independant",
    "self-employed", "contractor", "prestataire",
]


def _norm_contracts(contract_type: Optional[List[str]]) -> List[str]:
    return [str(c).strip().lower() for c in (contract_type or []) if str(c).strip()]


def contract_intent(contract_type: Optional[List[str]] = None,
                    target_roles: Optional[List[str]] = None) -> Dict[str, bool]:
    """Interprète les préférences de contrat du profil.

    Retourne un dict de flags :
      wants_stage, wants_alternance, wants_internship (stage|alternance),
      wants_cdi, wants_cdd, wants_freelance,
      employment_only (CDI/CDD sans stage/alternance/freelance),
      internship_only, freelance_only
    """
    contracts = _norm_contracts(contract_type)
    roles_blob = " ".join(target_roles or []).lower()

    wants_stage = any("stage" in c for c in contracts) or any(
        kw in roles_blob for kw in STAGE_TITLE_KEYWORDS
    )
    wants_alternance = any("alternance" in c for c in contracts) or any(
        kw in roles_blob for kw in ALTERNANCE_TITLE_KEYWORDS
    )
    wants_internship = wants_stage or wants_alternance or any(
        kw in roles_blob for kw in INTERNSHIP_TITLE_KEYWORDS
    )
    wants_cdi = any(c == "cdi" or c.startswith("cdi") for c in contracts)
    wants_cdd = any(c == "cdd" or c.startswith("cdd") for c in contracts)
    wants_freelance = any(
        "freelance" in c or "indépendant" in c or "independant" in c for c in contracts
    ) or any(kw in roles_blob for kw in ("freelance", "indépendant", "independant"))

    has_employment = wants_cdi or wants_cdd
    # CDI/CDD choisis sans stage/alternance/freelance → on bloque ces types
    employment_only = has_employment and not wants_internship and not wants_freelance
    # Uniquement stage et/ou alternance
    internship_only = wants_internship and not has_employment and not wants_freelance
    # Uniquement freelance
    freelance_only = wants_freelance and not has_employment and not wants_internship

    return {
        "wants_stage": wants_stage,
        "wants_alternance": wants_alternance,
        "wants_internship": wants_internship,
        "wants_cdi": wants_cdi,
        "wants_cdd": wants_cdd,
        "wants_freelance": wants_freelance,
        "employment_only": employment_only,
        "internship_only": internship_only,
        "freelance_only": freelance_only,
        "has_any_contract": bool(contracts) or wants_internship or wants_freelance,
    }


def _wants_internship(target_roles: List[str], contract_type: Optional[List[str]] = None) -> bool:
    """Renvoie True si l'utilisateur cherche explicitement un stage/alternance."""
    return contract_intent(contract_type, target_roles)["wants_internship"]


def linkedin_job_type_params(
    contract_type: Optional[List[str]] = None,
    target_roles: Optional[List[str]] = None,
) -> Dict[str, str]:
    """Paramètres LinkedIn f_JT / f_E dérivés des contrats recherchés."""
    intent = contract_intent(contract_type, target_roles)
    jt: List[str] = []
    params: Dict[str, str] = {}

    if intent["internship_only"]:
        jt.append("I")
        params["f_E"] = "1"
    elif intent["freelance_only"]:
        jt.append("C")
    elif intent["employment_only"]:
        jt.append("F")
        if intent["wants_cdd"]:
            jt.append("T")
    else:
        # Mix explicite : on combine les filtres LinkedIn correspondants
        if intent["wants_cdi"] or intent["wants_cdd"]:
            jt.append("F")
            if intent["wants_cdd"]:
                jt.append("T")
        if intent["wants_internship"]:
            jt.append("I")
        if intent["wants_freelance"]:
            jt.append("C")

    if jt:
        # Déduplique en gardant l'ordre
        seen: Set[str] = set()
        ordered = []
        for code in jt:
            if code not in seen:
                seen.add(code)
                ordered.append(code)
        params["f_JT"] = ",".join(ordered)
    return params


def _title_matches_any(title: str, keywords: List[str]) -> bool:
    return any(kw in title for kw in keywords)


def filter_jobs(jobs: List[Dict], config: Dict, target_roles: Optional[List[str]] = None,
                contract_type: Optional[List[str]] = None) -> List[Dict]:
    """Filtre les offres selon config.yaml + gardes-fous de type de contrat.

    - CDI/CDD (sans stage/alternance) → exclut stage/alternance du titre
    - Stage / Alternance seuls → n'accepte que les titres correspondants
    - Freelance seul → n'accepte que les titres mission/freelance
    """
    filters = config.get("filters", {})
    exclude = [k.lower() for k in filters.get("exclude_keywords", [])]
    require = [k.lower() for k in filters.get("require_keywords", [])]

    intent = contract_intent(contract_type, target_roles)
    # Comportement historique : on ne bloque stage/alternance que si on a un
    # contexte profil (rôles ou contrats). Sans info → pas de filtre contrat.
    has_profile_context = target_roles is not None or bool(contract_type)
    block_internships = has_profile_context and not intent["wants_internship"]

    filtered = []
    for job in jobs:
        text = f"{job.get('title', '')} {job.get('description', '')}".lower()
        title_lower = job.get("title", "").lower()
        contract_field = str(job.get("contract") or "").lower()
        haystack = f"{title_lower} {contract_field}"

        if any(ex in title_lower for ex in exclude):
            continue

        # ── Garde-fou : pas de stage/alternance si on cherche un emploi classique
        if (block_internships or intent["employment_only"]) and _title_matches_any(
            haystack, INTERNSHIP_TITLE_KEYWORDS
        ):
            continue

        # ── Garde-fou : stage/alternance uniquement
        if intent["internship_only"]:
            ok = False
            if intent["wants_stage"] and _title_matches_any(haystack, STAGE_TITLE_KEYWORDS):
                ok = True
            if intent["wants_alternance"] and _title_matches_any(haystack, ALTERNANCE_TITLE_KEYWORDS):
                ok = True
            if not ok:
                continue

        # ── Garde-fou : freelance uniquement
        if intent["freelance_only"]:
            if not (
                _title_matches_any(haystack, FREELANCE_TITLE_KEYWORDS)
                or "freelance" in contract_field
                or "indépend" in contract_field
                or "independ" in contract_field
            ):
                continue

        # ── CDI/CDD : aussi écarter les titres clairement freelance
        if intent["employment_only"] and _title_matches_any(haystack, FREELANCE_TITLE_KEYWORDS):
            continue

        if require and not any(req in text for req in require):
            continue

        filtered.append(job)

    return filtered


def normalize_job_text(text: str) -> str:
    """Normalise titre/entreprise pour dédup cross-source (LinkedIn ↔ HelloWork)."""
    text = unicodedata.normalize("NFKD", (text or "").strip().lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def job_fingerprint(job: Dict) -> str:
    """Empreinte titre+entreprise — détecte la même offre sur plusieurs plateformes."""
    title = normalize_job_text(job.get("title", ""))
    company = normalize_job_text(job.get("company", ""))
    if not title or not company or company in ("n a", "na", "?"):
        return ""
    return f"fp:{title}|{company}"


def is_job_seen(job: Dict, seen: Set[str]) -> bool:
    """True si l'offre est déjà connue (URL ou doublon cross-source)."""
    key = job_key(job)
    if key and key in seen:
        return True
    fp = job_fingerprint(job)
    return bool(fp and fp in seen)


def mark_job_seen(job: Dict, seen: Set[str]) -> None:
    """Enregistre URL + empreinte titre/entreprise."""
    key = job_key(job)
    if key:
        seen.add(key)
    fp = job_fingerprint(job)
    if fp:
        seen.add(fp)


def dedup_jobs(jobs: List[Dict]) -> List[Dict]:
    """Déduplique les offres par URL ou empreinte titre+entreprise."""
    seen_keys: Set[str] = set()
    seen_fps: Set[str] = set()
    unique = []
    for job in jobs:
        key = job_key(job)
        fp = job_fingerprint(job)
        if (key and key in seen_keys) or (fp and fp in seen_fps):
            continue
        if key:
            seen_keys.add(key)
        if fp:
            seen_fps.add(fp)
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


def job_score(job: Dict) -> int:
    """Score de fit normalisé (-1 si absent)."""
    s = job.get("_fit_score")
    if isinstance(s, int):
        return s
    s = job.get("fit_score")
    return s if isinstance(s, int) else -1


def sort_jobs_by_score(jobs: List[Dict]) -> List[Dict]:
    """Tri décroissant par score, puis ordre d'apparition (_idx) — aligné dashboard."""
    return sorted(
        jobs,
        key=lambda j: (-job_score(j), j.get("_idx") if isinstance(j.get("_idx"), int) else 10**9),
    )


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
