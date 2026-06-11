"""
JobAnalyzer — utilise Claude pour extraire les infos clés d'une offre.
Retourne un dict structuré utilisé par les autres generators.
"""

import os
import json
import anthropic
from typing import Dict, Optional
from rich.console import Console
from job_language import detect_job_language, normalize_language

console = Console()


ANALYZE_PROMPT = """Tu es un expert RH. Analyse cette offre d'emploi et retourne un JSON avec exactement ces champs :

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
  "why_interesting": "Ce qui rend ce poste attrayant pour ce candidat, 1-2 phrases",
  "fit_score": 7,
  "fit_reasoning": "Pourquoi ce score, 1-2 phrases"
}}

PROFIL DU CANDIDAT :
{candidate}

OFFRE À ANALYSER :
Titre : {title}
Entreprise : {company}
Description :
{description}

Retourne UNIQUEMENT le JSON, sans markdown ni explication."""

# Fallback si aucun profil utilisateur (usage CLI historique)
DEFAULT_CANDIDATE = """- Grégoire Linée, fondateur de Gare ta Bécane (€850k ARR, marketplace B2B2C de parking moto, 3 ans)
- Compétences : Product, GTM, AI/Automation, Growth, Ops, Code (React, Supabase, Python)
- Cherche : Paris, 60-70k€, product/ops/automation, niveau mid
- Parle : Français (natif), Anglais (bon)"""


def load_candidate_profile() -> str:
    """Construit le bloc profil candidat depuis Supabase (profil onboarding + CV uploadé)."""
    uid = os.environ.get("JA_USER_ID")
    if not uid:
        return DEFAULT_CANDIDATE
    try:
        from user_profile import load_user_profile, candidate_block_for_letter

        prof = load_user_profile()
        if prof.get("_source") == "user":
            return candidate_block_for_letter(prof)
    except Exception:
        pass
    return DEFAULT_CANDIDATE


class JobAnalyzer:
    def __init__(self, api_key: str, model: str = "claude-opus-4-6",
                 candidate_profile: Optional[str] = None):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.candidate = candidate_profile or load_candidate_profile()

    def analyze(self, job: Dict) -> Dict:
        """Analyse une offre et retourne ses infos structurées."""
        title = job.get("title", "N/A")
        company = job.get("company", "N/A")
        description = job.get("description", "")

        if not description:
            console.print(f"[yellow]  Pas de description pour {company} – {title}[/yellow]")
            return self._empty_analysis(job)

        prompt = ANALYZE_PROMPT.format(
            candidate=self.candidate,
            title=title,
            company=company,
            description=description[:4000],  # limite pour éviter les tokens trop longs
        )

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()

            # Nettoie si markdown
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            raw = raw.strip().rstrip("```").strip()

            analysis = json.loads(raw)
            analysis["job"] = job  # on attache l'offre originale
            analysis["language"] = normalize_language(
                analysis.get("language") or detect_job_language(job)
            )
            return analysis

        except json.JSONDecodeError as e:
            console.print(f"[red]  JSON parse error pour {company}: {e}[/red]")
            return self._empty_analysis(job)
        except Exception as e:
            console.print(f"[red]  Analyze error: {e}[/red]")
            return self._empty_analysis(job)

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
        }

    def filter_by_fit(self, analyses: list, min_score: int = 6) -> list:
        """Filtre les offres avec un score de compatibilité suffisant."""
        return [a for a in analyses if a.get("fit_score", 0) >= min_score]
