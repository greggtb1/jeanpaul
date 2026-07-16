"""
JobAnalyzer — utilise Claude pour extraire les infos clés d'une offre.
Retourne un dict structuré utilisé par les autres generators.
"""

import os
import json
import re
import unicodedata
import anthropic
from typing import Dict, List, Optional
from rich.console import Console
from job_language import detect_job_language, normalize_language
from generators.cover_letter import create_message_with_retry

console = Console()


ANALYZE_INSTRUCTIONS = """Tu es un expert RH. Analyse cette offre d'emploi et retourne un JSON avec exactement ces champs :

{{
  "role_summary": "Résumé du poste en 2 phrases max",
  "key_responsibilities": ["liste des 3-5 responsabilités principales"],
  "required_skills": ["liste des compétences requises"],
  "nice_to_have": ["compétences bonus"],
  "company_culture": "ton/culture de l'entreprise en 1 phrase",
  "company_description": "description de l'entreprise en 2 phrases",
  "seniority": "junior|mid|senior",
  "language": "fr|en — langue principale de l'OFFRE (texte de l'annonce), indépendamment du profil candidat",
  "salary_range": "fourchette si mentionnée, sinon vide",
  "why_interesting": "Ce qui rend ce poste attrayant pour TOI (2e personne, « tu »), 1-2 phrases",
  "fit_score": 7,
  "fit_reasoning": "Pourquoi ce score, adressé à TOI (2e personne, « tu »), 1-2 phrases"
}}

IMPORTANT — Évaluation du fit :
- Le candidat peut ne PAS avoir de CV. Le bloc PROFIL CANDIDAT (parcours, postes visés, lieux, niveau) suffit pour noter.
- Attribue TOUJOURS un fit_score entier entre 1 et 10 selon la pertinence réelle.
- Ne retourne jamais 0 ni un message du type « impossible d'évaluer » ou « profil manquant ».
- Si le profil est partiel, fais la meilleure estimation possible à partir des infos disponibles.
- Si le PROFIL CANDIDAT liste des secteurs visés, pénalise fortement les offres hors secteur (fit_score ≤ 4) sauf correspondance métier exceptionnelle dans le bon secteur.
- À l'inverse, si l'entreprise, le titre ou la description matchent clairement un secteur visé, valorise ce signal dans fit_score et explique-le dans fit_reasoning.

IMPORTANT — Séniorité et années d'expérience (critère STRICT) :
- Compare toujours le niveau réel du candidat (années d'expérience, séniorité) aux exigences de l'offre AVANT de noter.
- Un écart de séniorité est un critère éliminatoire, pas une simple nuance. Ne le compense JAMAIS entièrement par un « mindset fondateur », des « compétences transférables » ou une « capacité à apprendre vite ».
- Estime les années d'expérience requises par l'offre (via le titre, la séniorité et les responsabilités) et compare-les à l'expérience du candidat :
  - Si l'offre exige nettement plus d'expérience que le candidat (par ex. 7+ ans requis alors que le candidat a ~4-5 ans), plafonne fit_score à 6 maximum.
  - Si l'écart est important (par ex. rôle Head / VP / Director / Lead / Principal ou 8+ ans requis alors que le candidat est mid/junior), plafonne fit_score à 5 maximum.
  - Un score de 9 ou 10 est réservé aux offres où le candidat atteint OU dépasse le niveau de séniorité et le nombre d'années d'expérience attendus.
- Les titres « Head of… », « VP », « Director », « Lead », « Principal », « Chief » indiquent un poste senior/executive : ne les note haut que si le parcours du candidat est réellement à ce niveau de responsabilité et d'ancienneté.
- Dans fit_reasoning, mentionne explicitement l'écart de séniorité/expérience quand il existe, sans le minimiser.

IMPORTANT — Ton des champs why_interesting et fit_reasoning :
- Adresse-toi TOUJOURS directement au candidat à la 2e personne du singulier : « Tu as… », « Ton profil… », « Ton expérience… », « Tu maîtrises… ».
- N'utilise JAMAIS la 3e personne (« il », « elle », « le candidat », « ce profil »).
- Si le PROFIL CANDIDAT indique un prénom réel, tu peux l'utiliser ponctuellement, sinon utilise « tu » sans exception.
- N'invente JAMAIS de prénom ni de nom.

IMPORTANT — Ponctuation :
- N'utilise JAMAIS de double tiret ("--") ni de tiret cadratin ("—") dans aucun champ. Utilise une virgule, un point ou "et" à la place."""

ANALYZE_JOB_SUFFIX = """

Retourne UNIQUEMENT le JSON, sans markdown ni explication."""

# Rétrocompat tests / imports éventuels
ANALYZE_PROMPT = (
    ANALYZE_INSTRUCTIONS
    + "\n\nPROFIL DU CANDIDAT :\n{candidate}\n\nOFFRE À ANALYSER :\n"
    + "Titre : {title}\nEntreprise : {company}\nDescription :\n{description}"
    + ANALYZE_JOB_SUFFIX
)

# Fallback si aucun profil utilisateur (usage CLI historique)
DEFAULT_CANDIDATE = """- Grégoire Linée, fondateur de Gare ta Bécane (€850k ARR, marketplace B2B2C de parking moto, 3 ans)
- Compétences : Product, GTM, AI/Automation, Growth, Ops, Code (React, Supabase, Python)
- Cherche : Paris, 60-70k€, product/ops/automation, niveau mid
- Parle : Français (natif), Anglais (bon)"""

SECTOR_KEYWORDS = {
    "culture medias": ["culture", "media", "medias", "presse", "edition", "audiovisuel", "spectacle"],
    "spectacle evenementiel": ["spectacle", "evenementiel", "event", "festival", "production"],
    "tech digital": ["tech", "digital", "saas", "logiciel", "software", "startup", "plateforme"],
    "sante social": ["sante", "medical", "medico", "social", "hopital", "clinique"],
    "finance assurance": ["finance", "fintech", "banque", "assurance", "asset", "risk"],
    "public administration": ["public", "administration", "collectivite", "ministere", "institution"],
    "commerce retail": ["commerce", "retail", "distribution", "e-commerce", "magasin"],
    "industrie": ["industrie", "industriel", "manufacturing", "usine", "production"],
    "education formation": ["education", "formation", "edtech", "ecole", "enseignement"],
    "hotellerie tourisme": ["hotellerie", "hotel", "tourisme", "travel", "restauration"],
    "environnement energie": ["environnement", "energie", "climat", "greentech", "renouvelable"],
    "juridique": ["juridique", "legal", "avocat", "droit", "compliance"],
    "immobilier": ["immobilier", "real estate", "proptech", "foncier"],
}


def load_candidate_profile() -> str:
    """Construit le bloc profil candidat depuis Supabase (profil onboarding + CV uploadé)."""
    uid = os.environ.get("JA_USER_ID")
    if not uid:
        return DEFAULT_CANDIDATE
    try:
        from user_profile import load_user_profile, candidate_block_for_letter

        prof = load_user_profile(force=True)
        if prof.get("_source") == "user":
            return candidate_block_for_letter(prof)
    except Exception:
        pass
    return DEFAULT_CANDIDATE


def load_candidate_target_sectors() -> List[str]:
    uid = os.environ.get("JA_USER_ID")
    if not uid:
        return []
    try:
        from user_profile import load_user_profile

        prof = load_user_profile()
        sectors = prof.get("target_sectors") or []
        return [s for s in sectors if isinstance(s, str) and s.strip()]
    except Exception:
        return []


_DOUBLE_DASH_RE = re.compile(r"\s*(?:--+|—)\s*")

_TEXT_FIELDS_TO_CLEAN = (
    "role_summary",
    "company_culture",
    "company_description",
    "why_interesting",
    "fit_reasoning",
)


def _strip_markdown_fence(raw: str) -> str:
    text = (raw or "").strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text[3:]
        if text.lstrip().startswith("json"):
            text = text.lstrip()[4:]
    return text.strip().rstrip("```").strip()


def _repair_truncated_json(text: str) -> str:
    """Ferme strings / tableaux / objets si la réponse LLM a été coupée."""
    s = text.rstrip()
    if not s:
        return s

    in_string = False
    escape = False
    stack: List[str] = []
    for ch in s:
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "{[":
            stack.append(ch)
        elif ch == "}" and stack and stack[-1] == "{":
            stack.pop()
        elif ch == "]" and stack and stack[-1] == "[":
            stack.pop()

    if in_string:
        s += '"'
    while stack:
        opener = stack.pop()
        s += "]" if opener == "[" else "}"
    return s


def _parse_analysis_json(raw: str) -> Dict:
    """Parse le JSON d'analyse, avec réparation si réponse tronquée."""
    cleaned = _strip_markdown_fence(raw)
    candidates = [cleaned]
    if "{" in cleaned:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if end > start:
            candidates.append(cleaned[start : end + 1])
        candidates.append(_repair_truncated_json(cleaned[start:]))

    last_err: Optional[json.JSONDecodeError] = None
    for chunk in candidates:
        chunk = (chunk or "").strip()
        if not chunk.startswith("{"):
            continue
        try:
            data = json.loads(chunk)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError as e:
            last_err = e
            repaired = _repair_truncated_json(chunk)
            if repaired != chunk:
                try:
                    data = json.loads(repaired)
                    if isinstance(data, dict):
                        return data
                except json.JSONDecodeError as e2:
                    last_err = e2
            continue
    if last_err:
        raise last_err
    raise json.JSONDecodeError("No valid JSON object in response", cleaned or raw, 0)


def _strip_double_dashes(value: str) -> str:
    """Remplace les doubles tirets / tirets cadratins par une virgule lisible."""
    cleaned = _DOUBLE_DASH_RE.sub(", ", str(value or ""))
    cleaned = re.sub(r",\s*,", ",", cleaned)
    cleaned = re.sub(r"^\s*,\s*|\s*,\s*$", "", cleaned)
    return cleaned.strip()


def _clean_analysis_text_fields(analysis: Dict) -> Dict:
    for field in _TEXT_FIELDS_TO_CLEAN:
        if isinstance(analysis.get(field), str):
            analysis[field] = _strip_double_dashes(analysis[field])
    return analysis


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "").lower())
    normalized = "".join(ch for ch in normalized if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", normalized).strip()


def _sector_keywords(sector: str) -> List[str]:
    raw = _normalize_text(sector)
    keywords = {raw}
    for token in re.split(r"[,/&+;|()\-\s]+", raw):
        if len(token) >= 4:
            keywords.add(token)
    for alias, values in SECTOR_KEYWORDS.items():
        if raw in alias or alias in raw or any(v in raw for v in values):
            keywords.update(values)
    return [k for k in keywords if len(k) >= 3]


def _sector_matches(target_sectors: List[str], job: Dict) -> List[str]:
    if not target_sectors:
        return []
    searchable = _normalize_text(
        " ".join([
            str(job.get("title") or ""),
            str(job.get("company") or ""),
            str(job.get("description") or "")[:4000],
        ])
    )
    matches: List[str] = []
    for sector in target_sectors:
        for keyword in _sector_keywords(sector):
            pattern = rf"(?<!\w){re.escape(_normalize_text(keyword))}s?(?!\w)"
            if re.search(pattern, searchable):
                matches.append(sector)
                break
    return list(dict.fromkeys(matches))


class JobAnalyzer:
    def __init__(self, api_key: str, model: str = "claude-opus-4-6",
                 candidate_profile: Optional[str] = None):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.candidate = candidate_profile or load_candidate_profile()
        self.target_sectors = load_candidate_target_sectors()
        # Instructions + profil : identiques sur tout un run → prompt caching Anthropic
        self._cached_prefix = (
            ANALYZE_INSTRUCTIONS
            + "\n\nPROFIL DU CANDIDAT :\n"
            + self.candidate
            + "\n\nOFFRE À ANALYSER :"
        )

    def _call_model(self, job_text: str, max_tokens: int = 2048):
        return create_message_with_retry(
            self.client,
            model=self.model,
            max_tokens=max_tokens,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": self._cached_prefix,
                            "cache_control": {"type": "ephemeral"},
                        },
                        {
                            "type": "text",
                            "text": job_text,
                        },
                    ],
                }
            ],
        )

    def analyze(self, job: Dict) -> Dict:
        """Analyse une offre et retourne ses infos structurées."""
        title = job.get("title", "N/A")
        company = job.get("company", "N/A")
        description = job.get("description", "")

        if not description:
            console.print(f"[yellow]  Pas de description pour {company} – {title}[/yellow]")
            return self._empty_analysis(job)

        job_text = (
            f"Titre : {title}\n"
            f"Entreprise : {company}\n"
            f"Description :\n{description[:4000]}"
            + ANALYZE_JOB_SUFFIX
        )

        try:
            analysis = None
            last_parse_err: Optional[Exception] = None
            for attempt, tokens in enumerate((2048, 3072)):
                response = self._call_model(job_text, max_tokens=tokens)
                raw = (response.content[0].text or "").strip()
                try:
                    analysis = _parse_analysis_json(raw)
                    break
                except json.JSONDecodeError as e:
                    last_parse_err = e
                    # Réessaie une fois si la réponse a été coupée.
                    if attempt == 0 and getattr(response, "stop_reason", None) == "max_tokens":
                        continue
                    if attempt == 0:
                        continue
                    raise

            if analysis is None:
                raise last_parse_err or json.JSONDecodeError(
                    "No valid JSON object in response", "", 0
                )

            analysis["job"] = job  # on attache l'offre originale
            analysis["language"] = normalize_language(
                analysis.get("language") or detect_job_language(job)
            )
            analysis = _clean_analysis_text_fields(analysis)
            analysis = self._apply_sector_score_bonus(analysis, job)
            return analysis

        except json.JSONDecodeError:
            console.print(f"[dim]  Analyse partielle indisponible pour {company}[/dim]")
            return self._empty_analysis(job)
        except Exception as e:
            console.print(f"[red]  Analyze error: {e}[/red]")
            return self._empty_analysis(job)

    def _apply_sector_score_bonus(self, analysis: Dict, job: Dict) -> Dict:
        matches = _sector_matches(self.target_sectors, job)
        analysis["sector_match"] = bool(matches)
        analysis["matched_sectors"] = matches

        if not matches:
            return analysis

        try:
            score = int(analysis.get("fit_score", 0))
        except Exception:
            score = 0
        if score <= 0:
            return analysis

        bonus = 2 if len(matches) >= 2 else 1
        boosted = min(10, score + bonus)
        if boosted != score:
            analysis["fit_score"] = boosted
            reason = (analysis.get("fit_reasoning") or "").strip()
            note = f"Domaine visé détecté ({', '.join(matches)}), score ajusté."
            analysis["fit_reasoning"] = f"{reason} {note}".strip()
        return analysis

    def _empty_analysis(self, job: Dict) -> Dict:
        return {
            "job": job,
            "role_summary": job.get("title", ""),
            "key_responsibilities": [],
            "required_skills": [],
            "nice_to_have": [],
            "company_culture": "",
            "company_description": "",
            "seniority": "mid",
            "language": detect_job_language(job),
            "salary_range": "",
            "why_interesting": "",
            "fit_score": 5,
            "fit_reasoning": "Analyse non disponible",
            "sector_match": False,
            "matched_sectors": [],
        }

    def filter_by_fit(self, analyses: list, min_score: int = 6) -> list:
        """Filtre les offres avec un score de compatibilité suffisant."""
        return [a for a in analyses if a.get("fit_score", 0) >= min_score]
