"""
Générateur de candidatures spontanées.

Pour une entreprise donnée, Claude :
 1. Analyse le profil de la boîte
 2. Invente le poste le plus probable pour Gregoire (PM / Ops / Growth / RevOps)
 3. Génère une lettre de motivation spontanée
 4. Adapte le CV pour ce rôle hypothétique
"""

import re
from pathlib import Path
from typing import Dict, Optional
from rich.console import Console

from profile import PROFILE

console = Console()

# Prompt principal pour l'analyse + génération
_ANALYZE_PROMPT = """Tu es un expert en recrutement tech et en personal branding.

## Profil du candidat
Nom : {name}
Parcours :
{experience}

Compétences clés : {skills}
Tagline : {tagline}

## Entreprise cible
Nom : {company_name}
URL WTTJ : {company_url}
Description : {description}
Taille : {size}
Secteur : {industry}
Tags : {tags}
Mission/Valeurs : {mission}

## Ta mission
1. Analyse la boîte et déduis le rôle le plus pertinent pour ce candidat parmi :
   - Ops Manager / Head of Ops          ← priorité 1 (défaut si doute)
   - Business Operations / RevOps       ← priorité 2
   - Chief of Staff                     ← priorité 3
   - Product Manager / Head of Product  ← si la boîte est très orientée produit
   - Growth Manager / Head of Growth    ← UNIQUEMENT si la boîte est une marketplace ou un SaaS PLG
     où le growth est le cœur du modèle, PAS par défaut
   Justifie ton choix en 1-2 phrases basées sur le secteur et le profil de la boîte.

2. Write a spontaneous cover letter (150 words MAX, not one word more) that:
   - Language: English by default. Use French ONLY if the company description is written in French.
   - ALWAYS start with exactly this line: "Hello {company_name} team!" then a blank line before the first paragraph
   - Says in 1-2 sentences why this company is genuinely interesting (specific, not generic)
   - Mentions 1 concrete, quantified experience that proves Gregoire's value
   - Ends with a short, casual call-to-action to connect
   - Tone: like an email between humans, natural, no corporate jargon
   - FORBIDDEN: dashes at start of sentence, double dashes (--), bullet points, lists,
     pompous phrases ("I take the liberty of", "Dear Hiring Manager"), empty superlatives ("passionate", "dynamic"),
     decorative punctuation. Short sentences only, fluid prose only.

3. Formule 3 bullets "quick wins" : ce que Gregoire pourrait faire en 90 jours
   dans ce rôle (concrets, basés sur ses vraies expériences)

Réponds en JSON strict :
{{
  "role_hypothesis": "titre exact du rôle proposé",
  "role_justification": "pourquoi ce rôle pour cette boîte",
  "cover_letter": "texte complet de la lettre",
  "quick_wins": ["quick win 1", "quick win 2", "quick win 3"],
  "fit_score": 7,
  "fit_reasoning": "pourquoi ce candidat matche cette boîte"
}}
"""


def _clean_letter(text: str) -> str:
    """Supprime les tirets en début de ligne et les doubles tirets parasites."""
    import re
    lines = text.split("\n")
    cleaned = []
    for line in lines:
        # Supprime les tirets/puces en début de ligne
        line = re.sub(r"^\s*[-–—•]\s+", "", line)
        # Supprime les doubles tirets
        line = line.replace("--", "").replace("— ", " ").replace(" —", " ")
        # Supprime les tirets isolés en milieu de phrase (pattern " - ")
        line = re.sub(r"\s+-\s+", " ", line)
        cleaned.append(line)
    return "\n".join(cleaned).strip()


class SpontaneousGenerator:
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6",
                 cv_model: Optional[str] = None):
        """
        model    : modèle utilisé pour l'analyse + lettre + rôle (peut être Haiku, économique).
        cv_model : modèle utilisé pour le CV (par défaut = model). Garder Sonnet pour la qualité.
        """
        import anthropic
        self._client   = anthropic.Anthropic(api_key=api_key)
        self._model    = model
        self._cv_model = cv_model or model
        self._api_key  = api_key

    # ── Analyse + génération ──────────────────────────────────────────────────

    def analyze_and_generate(self, company: Dict,
                              output_dir: Path,
                              index: int = 0) -> Optional[Dict]:
        """
        Prend un profil d'entreprise, génère une candidature spontanée complète.
        Retourne les métadonnées de la candidature.
        """
        company_name = company.get("name", company.get("slug", "?"))
        console.print(f"[blue]  → Candidature spontanée : {company_name}[/blue]")

        # Formate le profil candidat
        exp_lines = []
        for e in PROFILE.get("experience", []):
            exp_lines.append(
                f"- {e['title']} @ {e['company']} ({e['period']}) : "
                + " | ".join(e.get("bullets", [])[:3])
            )

        prompt = _ANALYZE_PROMPT.format(
            name        = PROFILE["name"],
            experience  = "\n".join(exp_lines),
            skills      = ", ".join(PROFILE.get("skills", [])),
            tagline     = PROFILE.get("tagline", ""),
            company_name= company_name,
            company_url = company.get("url", ""),
            description = company.get("description", "")[:800] or "(pas de description disponible)",
            size        = company.get("size", "non précisé"),
            industry    = company.get("industry", "tech"),
            tags        = ", ".join(str(t) for t in company.get("tags", [])[:10]),
            mission     = company.get("mission", "")[:300] or "",
        )

        try:
            resp = self._client.messages.create(
                model      = self._model,
                max_tokens = 1500,
                messages   = [{"role": "user", "content": prompt}],
            )
            raw = resp.content[0].text.strip()
            # Extrait le JSON
            m = re.search(r"\{[\s\S]*\}", raw)
            if not m:
                console.print(f"[yellow]  JSON manquant pour {company_name}[/yellow]")
                return None
            data = __import__("json").loads(m.group(0))
        except Exception as e:
            console.print(f"[red]  Erreur Claude : {e}[/red]")
            return None

        fit_score = data.get("fit_score", 5)
        if fit_score < 5:
            console.print(f"[dim]  Score {fit_score}/10 — boîte ignorée[/dim]")
            return None

        # ── Sauvegarde des fichiers ───────────────────────────────────────────
        from utils.helpers import slugify, make_app_dir
        role  = data.get("role_hypothesis", "candidature-spontanee")
        app_dir = make_app_dir(output_dir, index, company_name, role)

        # Lettre de motivation — nom compatible dashboard
        cover = _clean_letter(data.get("cover_letter", ""))
        safe_name = re.sub(r"[^\w\-]", "_", company_name)[:40]
        (app_dir / f"LettreMotivation_{safe_name}.txt").write_text(cover, encoding="utf-8")

        # URL de candidature : direct spontaneous link si dispo, sinon /jobs
        wttj_base_url = company.get("url", "").rstrip("/")
        apply_url = company.get("apply_url", "") or (wttj_base_url + "/jobs")

        # Résumé candidature
        summary = (
            f"CANDIDATURE SPONTANÉE\n"
            f"Entreprise : {company_name}\n"
            f"URL WTTJ   : {apply_url}\n"
            f"Rôle ciblé : {role}\n"
            f"Score fit  : {fit_score}/10\n\n"
            f"Justification rôle :\n{data.get('role_justification','')}\n\n"
            f"Pourquoi ce match :\n{data.get('fit_reasoning','')}\n\n"
            f"Quick wins proposés :\n"
            + "\n".join(f"• {qw}" for qw in data.get("quick_wins", []))
        )
        (app_dir / "resume.txt").write_text(summary, encoding="utf-8")

        # job_info.json — requis par autosubmit
        import json as _json
        (app_dir / "job_info.json").write_text(_json.dumps({
            "job": {
                "company": company_name,
                "title":   role,
                "url":     apply_url,
                "type":    "spontaneous",
                "source":  "wttj",
            },
            "fit_score":    fit_score,
            "fit_reasoning": data.get("fit_reasoning", ""),
        }, ensure_ascii=False, indent=2), encoding="utf-8")

        # CV PDF
        try:
            import traceback
            from generators.cv_builder import CVBuilder
            cv      = CVBuilder(api_key=self._api_key, model=self._cv_model)
            company_slug = re.sub(r"[^a-z0-9]+", "_", company_name.lower()).strip("_")
            cv_path = app_dir / f"{company_slug}_CV_Gregoire_Linee.pdf"
            fake_analysis = {
                "job": {"company": company_name, "title": role},
                "role_summary": data.get("role_justification", ""),
                "required_skills": PROFILE.get("skills", [])[:6],
                "key_responsibilities": data.get("quick_wins", []),
                "fit_score": data.get("fit_score", 7),
                "company_culture": data.get("fit_reasoning", ""),
            }
            cv.generate_and_save(fake_analysis, cv_path)
            console.print(f"[green]    ✓ CV généré[/green]")
        except Exception as e:
            console.print(f"[red]    ✗ CV erreur : {e}[/red]")
            console.print(f"[dim]{traceback.format_exc()}[/dim]")

        console.print(
            f"[green]    ✓ {company_name} → {role} (score {fit_score}/10)[/green]"
        )

        return {
            "type":         "spontaneous",
            "company":      company_name,
            "company_url":  company.get("url", "").rstrip("/") + "/jobs",
            "role":         role,
            "fit_score":    fit_score,
            "fit_reasoning":data.get("fit_reasoning", ""),
            "app_dir":      str(app_dir),
            "cover_letter": cover,
            "quick_wins":   data.get("quick_wins", []),
        }
