"""
CVBuilder — génère un CV PDF adapté à chaque offre.
Utilise reportlab pour un rendu propre et professionnel.
Adapte le contenu via Claude : tagline, bullets, compétences.
"""

import anthropic
import json
import os
from pathlib import Path
from typing import Dict, List, Optional

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus.flowables import HRFlowable

from rich.console import Console
from profile import PROFILE
from user_profile import load_user_profile, _extract_pdf_text
from job_language import language_from_analysis, language_labels
from text_sanitize import NO_DASH_RULE, NO_DASH_RULE_EN, strip_dashes, strip_dashes_deep

console = Console()

# Schémas JSON pour sortie structurée (évite les réponses tronquées / invalides)
CV_PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "tagline": {"type": "string"},
        "top_skills": {"type": "array", "items": {"type": "string"}},
        "top_tools": {"type": "array", "items": {"type": "string"}},
        "experience_highlights": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "company": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["company", "bullets"],
                "additionalProperties": False,
            },
        },
        "custom_note": {"type": "string"},
    },
    "required": ["tagline", "top_skills", "top_tools", "experience_highlights", "custom_note"],
    "additionalProperties": False,
}

CV_UPLOAD_SCHEMA = {
    "type": "object",
    "properties": {
        "tagline": {"type": "string"},
        "top_skills": {"type": "array", "items": {"type": "string"}},
        "top_tools": {"type": "array", "items": {"type": "string"}},
        "experiences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "company": {"type": "string"},
                    "period": {"type": "string"},
                    "location": {"type": "string"},
                    "bullets": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "company", "period", "bullets"],
                "additionalProperties": False,
            },
        },
        "education": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "degree": {"type": "string"},
                    "school": {"type": "string"},
                    "detail": {"type": "string"},
                },
                "required": ["degree", "school"],
                "additionalProperties": False,
            },
        },
        "languages": {"type": "string"},
        "custom_note": {"type": "string"},
    },
    "required": ["tagline", "top_skills", "top_tools", "experiences", "education", "languages", "custom_note"],
    "additionalProperties": False,
}


def _experience_highlights_map(highlights) -> Dict[str, List[str]]:
    """Normalise experience_highlights (array structuré ou ancien dict)."""
    if isinstance(highlights, dict):
        return highlights
    if isinstance(highlights, list):
        return {
            item.get("company", ""): item.get("bullets", [])
            for item in highlights
            if isinstance(item, dict) and item.get("company")
        }
    return {}


def _parse_llm_json(text: str) -> Dict:
    """Extrait et parse le JSON renvoyé par Claude."""
    text = text.strip()
    candidates = [text]
    if "```" in text:
        candidates.extend(text.split("```"))
    last_err: json.JSONDecodeError | None = None
    for chunk in candidates:
        chunk = chunk.strip()
        if chunk.startswith("json"):
            chunk = chunk[4:].strip()
        if not chunk.startswith("{"):
            continue
        try:
            return json.loads(chunk)
        except json.JSONDecodeError as e:
            last_err = e
            continue
    if last_err:
        raise last_err
    raise json.JSONDecodeError("No valid JSON object in response", text, 0)

# ── Couleurs ──────────────────────────────────────────────────────────────────
DARK        = colors.HexColor("#1A1A2E")
GRAY        = colors.HexColor("#555555")
LIGHT       = colors.HexColor("#888888")
ACCENT      = colors.HexColor("#2D6BE4")
ACCENT_PALE = colors.HexColor("#EEF3FD")
LINE        = colors.HexColor("#DDDDDD")

# ── Styles ────────────────────────────────────────────────────────────────────
def make_styles():
    return {
        "name": ParagraphStyle("name",
            fontName="Helvetica-Bold", fontSize=22,
            textColor=DARK, spaceAfter=4, leading=26),

        "tagline": ParagraphStyle("tagline",
            fontName="Helvetica-Oblique", fontSize=10,
            textColor=GRAY, spaceAfter=3, leading=14),

        "website": ParagraphStyle("website",
            fontName="Helvetica-Bold", fontSize=10.5,
            textColor=ACCENT, spaceAfter=2, leading=13),

        "contact": ParagraphStyle("contact",
            fontName="Helvetica", fontSize=9,
            textColor=LIGHT, spaceAfter=0, leading=13),

        "section": ParagraphStyle("section",
            fontName="Helvetica-Bold", fontSize=9,
            textColor=DARK, spaceBefore=14, spaceAfter=4,
            leading=12, letterSpacing=0.8),

        "job_title": ParagraphStyle("job_title",
            fontName="Helvetica-Bold", fontSize=10.5,
            textColor=DARK, spaceBefore=8, spaceAfter=1, leading=13),

        "company": ParagraphStyle("company",
            fontName="Helvetica-Oblique", fontSize=10,
            textColor=GRAY, spaceAfter=2, leading=13),

        "bullet": ParagraphStyle("bullet",
            fontName="Helvetica", fontSize=9.5,
            textColor=colors.HexColor("#333333"),
            leftIndent=12, spaceAfter=1, leading=13,
            bulletIndent=4, bulletText="•"),

        "skills_label": ParagraphStyle("skills_label",
            fontName="Helvetica-Bold", fontSize=9.5,
            textColor=DARK, spaceAfter=2, leading=12),

        "skills_value": ParagraphStyle("skills_value",
            fontName="Helvetica", fontSize=9.5,
            textColor=GRAY, spaceAfter=4, leading=12),

        "lang": ParagraphStyle("lang",
            fontName="Helvetica", fontSize=9.5,
            textColor=GRAY, spaceAfter=0, leading=13),

        "candidature_label": ParagraphStyle("candidature_label",
            fontName="Helvetica", fontSize=8,
            textColor=LIGHT, spaceAfter=0, leading=11,
            letterSpacing=0.5),

        "candidature_value": ParagraphStyle("candidature_value",
            fontName="Helvetica-Bold", fontSize=10,
            textColor=DARK, spaceAfter=0, leading=12),

        "candidature_banner": ParagraphStyle("candidature_banner",
            fontName="Helvetica", fontSize=8,
            textColor=LIGHT, spaceAfter=0, leading=11),
    }


def clean_text(text: str) -> str:
    """Supprime les tirets et doubles tirets parasites du texte."""
    return strip_dashes(text)


# ── Prompt d'adaptation ───────────────────────────────────────────────────────
ADAPT_CV_PROMPT = """Tu es un expert en recrutement. Adapte le CV du candidat pour maximiser sa pertinence pour cette offre.

PROFIL :
{profile_json}

OFFRE :
Titre : {title}
Entreprise : {company}
Résumé : {role_summary}
Compétences requises : {required_skills}
Responsabilités : {responsibilities}
Culture : {company_culture}

STRICT RULES:
- {no_dash_rule}
- Short, active sentences with numbers when possible
- Do NOT invent experiences or skills that are not in the profile
- Use ONLY the companies listed in the profile's experience section
- ALL output must be in {output_lang}

Retourne un JSON :
{{
  "tagline": "Tagline adapté au poste, 1 à 2 phrases max, sans tiret",
  "top_skills": ["3 à 5 compétences clés pour ce poste"],
  "top_tools": ["outils dev du profil triés par pertinence — NE PAS inclure les outils automation/IA"],
  "experience_highlights": [
    {{"company": "<nom exact d'une entreprise du profil>", "bullets": ["2-3 bullets adaptés, sans tiret"]}}
  ],
  "custom_note": "Optional note below tagline, empty if not needed"
}}

Return ONLY the JSON. All text values must be in {output_lang}."""


# ── Prompt CV PME/ETI — en français, framing management pas tech ──────────────
ADAPT_CV_PROMPT_PME = """Tu es un expert en recrutement RH pour les PME et ETI françaises. Adapte le CV du candidat pour maximiser sa pertinence pour ce poste de management/opérations.

PROFIL :
{profile_json}

POSTE :
Titre : {title}
Entreprise : {company}
Résumé : {role_summary}
Compétences requises : {required_skills}
Responsabilités : {responsibilities}
Culture : {company_culture}

RÈGLES STRICTES :
- {no_dash_rule}
- Phrases courtes et actives, avec des chiffres concrets quand c'est possible
- NE PAS inventer d'expériences ou compétences absentes du profil
- Utiliser UNIQUEMENT les entreprises listées dans l'expérience du profil
- Tout le texte de sortie DOIT être en {output_lang}
- Framer le profil comme un profil de direction/management opérationnel, PAS comme un profil tech ou startup
- Mettre en avant : pilotage P&L, gestion partenaires/équipes, structuration de processus, organisation, résultats business
- Minimiser les références purement tech (code, React, etc.) — à ne mentionner que si pertinent pour l'offre

Retourne un JSON :
{{
  "tagline": "Accroche adaptée au poste, 1 à 2 phrases max, sans tiret, ton management pas tech",
  "top_skills": ["3 à 5 compétences clés pour ce poste, orientées management/ops"],
  "top_tools": ["Outils pertinents pour ce poste — mettre en avant Excel/ERP/outils métier si mentionnés, garder les outils dev uniquement si vraiment pertinents"],
  "experience_highlights": [
    {{"company": "<nom exact d'une entreprise du profil>", "bullets": ["2-3 bullets adaptés, sans tiret"]}}
  ],
  "custom_note": "Note optionnelle sous l'accroche, vide si inutile"
}}

Retourne UNIQUEMENT le JSON. Toutes les valeurs texte doivent être en {output_lang}."""

ADAPT_CV_FROM_UPLOAD = """Tu es un expert RH. Adapte le CV du candidat (texte source ci-dessous) pour cette offre précise.

CV SOURCE (uploadé par le candidat — ne rien inventer) :
{cv_text}

INFOS :
Nom : {name}
Postes visés : {target_roles}

OFFRE :
Titre : {title}
Entreprise : {company}
Résumé : {role_summary}
Compétences requises : {required_skills}
Responsabilités : {responsibilities}

RÈGLES :
- {no_dash_rule}
- Ne pas inventer d'expériences absentes du CV source
- Langue de sortie : {output_lang}
- Mettre en avant ce qui matche le plus pour CETTE offre
- Maximum 5 expériences (les plus pertinentes pour l'offre), 2 à 3 bullets courts par expérience
- Bullets concis (≤ 15 mots), pas de copier-coller du CV source

Retourne UNIQUEMENT un JSON :
{{
  "tagline": "Accroche adaptée au poste, 1-2 phrases",
  "top_skills": ["3-5 compétences clés pour ce poste"],
  "top_tools": ["outils pertinents mentionnés dans le CV"],
  "experiences": [
    {{"title": "...", "company": "...", "period": "...", "location": "", "bullets": ["...", "..."]}}
  ],
  "education": [{{"degree": "...", "school": "...", "detail": "..."}}],
  "languages": "ex. Français (natif) · Anglais (courant) — dans la langue de sortie",
  "custom_note": ""
}}"""

_CV_SECTIONS = {
    "fr": {
        "application_for": "CANDIDATURE POUR",
        "company": "ENTREPRISE",
        "experience": "Expérience",
        "education": "Formation",
        "skills_tools": "Compétences & outils",
        "skills": "Compétences",
        "tools": "Outils",
        "automation": "Automation & IA",
        "languages": "Langues",
    },
    "en": {
        "application_for": "APPLICATION FOR",
        "company": "COMPANY",
        "experience": "Experience",
        "education": "Education",
        "skills_tools": "Skills & Tools",
        "skills": "Skills",
        "tools": "Tools",
        "automation": "Automation & AI",
        "languages": "Languages",
    },
}


class CVBuilder:
    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6", pme_mode: bool = False,
                 profile: Optional[Dict] = None):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.pme_mode = pme_mode
        self.profile = profile or load_user_profile(force=bool(os.environ.get("JA_USER_ID")))

    def _uses_uploaded_cv(self) -> bool:
        return bool(
            self.profile.get("_source") == "user"
            and self.profile.get("_has_uploaded_cv")
            and (self.profile.get("cv_text") or self._cv_source_text()).strip()
        )

    def _resolve_job(self, analysis: Dict, job: Optional[Dict] = None) -> Dict:
        if job and (job.get("title") or job.get("company")):
            return job
        embedded = analysis.get("job") or {}
        return embedded

    def _cv_source_text(self) -> str:
        text = (self.profile.get("cv_text") or "").strip()
        if text:
            return text
        url = self.profile.get("cv_url") or ""
        if not url:
            return ""
        text = _extract_pdf_text(url)
        if text:
            self.profile["cv_text"] = text
        return text

    def adapt_content(self, analysis: Dict, job: Optional[Dict] = None) -> Dict:
        """Demande à Claude d'adapter le contenu du CV."""
        job = self._resolve_job(analysis, job)
        responsibilities = "\n".join(analysis.get("key_responsibilities", []))
        required_skills = ", ".join(analysis.get("required_skills", []))
        lang_code, output_lang = language_labels(language_from_analysis(analysis))

        cv_text = self._cv_source_text()
        if self._uses_uploaded_cv():
            if not cv_text:
                console.print(
                    "[red]  CV uploadé illisible — vérifiez le PDF dans votre profil[/red]"
                )
                return self._default_adaptation()
            prompt = ADAPT_CV_FROM_UPLOAD.format(
                cv_text=cv_text[:12000],
                name=self.profile.get("name", ""),
                target_roles=", ".join(self.profile.get("target_roles") or []),
                title=job.get("title", ""),
                company=job.get("company", ""),
                role_summary=analysis.get("role_summary", ""),
                required_skills=required_skills,
                responsibilities=responsibilities,
                output_lang=output_lang,
                no_dash_rule=NO_DASH_RULE if lang_code == "fr" else NO_DASH_RULE_EN,
            )
        else:
            _PROFILE_JSON_EXCLUDE = {
                "motivation_hook", "cv_text", "cv_url", "_source", "_has_uploaded_cv",
                "tone_hint", "letter_tone", "letter_sample", "salary_min",
            }
            profile_json = json.dumps(
                {k: v for k, v in self.profile.items() if k not in _PROFILE_JSON_EXCLUDE},
                ensure_ascii=False, indent=2,
            )
            base_prompt = ADAPT_CV_PROMPT_PME if self.pme_mode else ADAPT_CV_PROMPT
            prompt = base_prompt.format(
                profile_json=profile_json,
                title=job.get("title", ""),
                company=job.get("company", ""),
                role_summary=analysis.get("role_summary", ""),
                required_skills=required_skills,
                responsibilities=responsibilities,
                company_culture=analysis.get("company_culture", ""),
                output_lang=output_lang,
                no_dash_rule=NO_DASH_RULE if lang_code == "fr" else NO_DASH_RULE_EN,
            )

        try:
            schema = CV_UPLOAD_SCHEMA if self._uses_uploaded_cv() else CV_PROFILE_SCHEMA
            max_tokens = 4096 if self._uses_uploaded_cv() else 2048
            try:
                resp = self.client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    messages=[{"role": "user", "content": prompt}],
                    output_config={
                        "format": {"type": "json_schema", "schema": schema},
                    },
                )
            except Exception as schema_err:
                console.print(f"[yellow]  CV adapt JSON schema fallback: {schema_err}[/yellow]")
                resp = self.client.messages.create(
                    model=self.model,
                    max_tokens=max_tokens,
                    messages=[{"role": "user", "content": prompt}],
                )
            raw = resp.content[0].text.strip()
            if resp.stop_reason == "max_tokens":
                console.print("[yellow]  CV adapt: réponse tronquée (max_tokens)[/yellow]")
            return strip_dashes_deep(_parse_llm_json(raw))
        except Exception as e:
            console.print(f"[red]  CV adapt error: {e}[/red]")
            return self._default_adaptation()

    def _append_cv_text_fallback(self, story, S, section_label: str):
        """Dernier recours : afficher le texte extrait du CV uploadé."""
        cv_text = (self.profile.get("cv_text") or "").strip()
        if not cv_text:
            return False
        story.append(Paragraph(section_label.upper(), S["section"]))
        story.append(HRFlowable(width="100%", thickness=1, color=DARK, spaceAfter=4))
        for block in cv_text.split("\n\n")[:10]:
            block = clean_text(block.strip())
            if len(block) < 4:
                continue
            safe = block.replace("&", "&amp;").replace("<", "&lt;").replace("\n", "<br/>")
            story.append(Paragraph(safe, S["bullet"]))
        return True

    def _default_adaptation(self) -> Dict:
        p = self.profile
        if self._uses_uploaded_cv():
            return {
                "tagline": p.get("tagline") or "",
                "top_skills": [],
                "top_tools": [],
                "experience_highlights": [],
                "experiences": [],
                "education": [],
                "languages": "",
                "custom_note": "",
            }
        is_user = p.get("_source") == "user"
        return {
            "tagline": p.get("tagline") or ("" if is_user else PROFILE["tagline"]),
            "top_skills": p.get("skills") or ([] if is_user else PROFILE["skills"]),
            "top_tools": (p.get("tools") or {}).get("dev") or ([] if is_user else PROFILE["tools"]["dev"]),
            "experience_highlights": [],
            "experiences": [],
            "custom_note": "",
        }

    def build_pdf(self, adaptation: Dict, output_path: Path,
                  company: str = "", job_title: str = "", lang: str = "fr") -> Path:
        """Construit le CV en PDF avec reportlab."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        S = make_styles()

        doc = SimpleDocTemplate(
            str(output_path),
            pagesize=A4,
            topMargin=1.8*cm, bottomMargin=1.8*cm,
            leftMargin=2.2*cm, rightMargin=2.2*cm,
        )

        story = []
        L = _CV_SECTIONS.get(lang if lang in _CV_SECTIONS else "fr", _CV_SECTIONS["fr"])

        def hr():
            story.append(Spacer(1, 2))
            story.append(HRFlowable(width="100%", thickness=0.5, color=LINE, spaceAfter=4))

        def section_title(text):
            story.append(Paragraph(text.upper(), S["section"]))
            story.append(HRFlowable(width="100%", thickness=1, color=DARK, spaceAfter=4))

        def add_exp(title, company, period, bullets, location=""):
            label = f"{company}   {location}".strip() if location else company
            title_table = Table(
                [[Paragraph(title, S["job_title"]), Paragraph(period, ParagraphStyle(
                    "period", fontName="Helvetica", fontSize=9.5,
                    textColor=LIGHT, alignment=TA_RIGHT, leading=13, spaceBefore=8
                ))]],
                colWidths=["70%", "30%"],
                hAlign="LEFT",
            )
            title_table.setStyle(TableStyle([
                ("VALIGN", (0,0), (-1,-1), "BOTTOM"),
                ("BOTTOMPADDING", (0,0), (-1,-1), 0),
                ("TOPPADDING", (0,0), (-1,-1), 0),
            ]))
            story.append(title_table)
            story.append(Paragraph(label, S["company"]))
            for b in bullets:
                b_clean = clean_text(b)
                story.append(Paragraph(b_clean, S["bullet"]))

        # ── Référence offre (discret, en tête) ────────────────────────────────
        if company or job_title:
            parts = [p for p in (job_title, company) if p]
            banner_line = " · ".join(parts) if parts else ""

            if banner_line:
                story.append(Paragraph(banner_line, S["candidature_banner"]))
                story.append(Spacer(1, 8))

        p = self.profile
        is_user = p.get("_source") == "user"
        story.append(Paragraph(p.get("name") or ("" if is_user else PROFILE["name"]), S["name"]))

        website = p.get("website", "")
        if website:
            story.append(Paragraph(website, S["website"]))

        tagline = clean_text(
            adaptation.get(
                "tagline",
                p.get("tagline") or ("" if (is_user or self._uses_uploaded_cv()) else PROFILE["tagline"]),
            )
        )
        story.append(Paragraph(tagline, S["tagline"]))

        custom = adaptation.get("custom_note", "")
        if custom:
            story.append(Paragraph(clean_text(custom), S["tagline"]))

        loc = p.get("location", "Paris")
        story.append(Paragraph(
            f"{p.get('email', '')}   ·   {p.get('phone', '')}   ·   {loc}",
            S["contact"],
        ))
        story.append(Spacer(1, 10))

        section_title(L["experience"])
        highlights = _experience_highlights_map(adaptation.get("experience_highlights", []))
        user_exps = adaptation.get("experiences") or []
        from_upload = self._uses_uploaded_cv()
        exp_added = False

        if user_exps:
            for exp in user_exps[:6]:
                bullets = [clean_text(b) for b in exp.get("bullets", [])[:5] if b]
                if not exp.get("title") and not bullets:
                    continue
                add_exp(
                    title=exp.get("title", ""),
                    company=exp.get("company", ""),
                    period=exp.get("period", ""),
                    bullets=bullets,
                    location=exp.get("location", ""),
                )
                exp_added = True
        elif not from_upload:
            default_exps = [] if is_user else PROFILE["experience"]
            for exp in p.get("experience") or default_exps:
                company = exp["company"]
                adapted = highlights.get(company, highlights.get(exp["title"], []))
                bullets = [clean_text(b) for b in (adapted if adapted else exp["bullets"])]
                add_exp(
                    title=exp["title"],
                    company=company,
                    period=exp["period"],
                    bullets=bullets[:5],
                    location=exp.get("location", ""),
                )
                exp_added = True

        if not exp_added:
            exp_added = self._append_cv_text_fallback(story, S, L["experience"])

        if not exp_added and not from_upload and not is_user:
            for exp in p.get("experience") or PROFILE["experience"]:
                add_exp(
                    title=exp["title"],
                    company=exp["company"],
                    period=exp["period"],
                    bullets=[clean_text(b) for b in exp.get("bullets", [])[:5]],
                    location=exp.get("location", ""),
                )

        section_title(L["education"])
        edu_list = adaptation.get("education") or []
        if edu_list:
            for edu in edu_list[:3]:
                add_exp(
                    title=edu.get("degree", ""),
                    company=edu.get("school", ""),
                    period="",
                    bullets=[edu.get("detail", "")] if edu.get("detail") else [],
                )
        elif not from_upload:
            default_edu = {} if is_user else PROFILE["education"]
            edu = p.get("education") or default_edu
            if isinstance(edu, dict) and edu.get("degree"):
                add_exp(
                    title=edu["degree"],
                    company=edu.get("school", ""),
                    period="",
                    bullets=[edu.get("track", "")] if edu.get("track") else [],
                )

        section_title(L["skills_tools"])
        default_skills = [] if is_user else PROFILE["skills"]
        default_tools = {} if is_user else PROFILE["tools"]
        top_skills = adaptation.get("top_skills") or ([] if from_upload else (p.get("skills") or default_skills))
        top_tools = adaptation.get("top_tools") or (
            [] if from_upload else (p.get("tools") or default_tools).get("dev", [])
        )
        auto_tools = [] if from_upload else (p.get("tools") or default_tools).get("automation", [])

        for label, items in [
            (L["skills"], top_skills),
            (L["tools"], top_tools),
            (L["automation"], auto_tools),
        ]:
            if items:
                story.append(Paragraph(f"<b>{label} :</b> {', '.join(items)}", S["skills_value"]))

        section_title(L["languages"])
        langs = adaptation.get("languages")
        if not langs and not from_upload:
            default_langs = {} if is_user else PROFILE["languages"]
            langs = "   ·   ".join(f"{l} ({v})" for l, v in (p.get("languages") or default_langs).items())
        if langs:
            story.append(Paragraph(langs, S["lang"]))

        doc.build(story)
        return output_path

    def generate_and_save(self, analysis: Dict, output_path: Path, job: Optional[Dict] = None) -> Path:
        """Adapte le contenu et génère le PDF."""
        job_data = self._resolve_job(analysis, job)
        adaptation = self.adapt_content(analysis, job_data)
        lang_code, _ = language_labels(language_from_analysis(analysis))
        return self.build_pdf(
            adaptation, output_path,
            company=job_data.get("company", ""),
            job_title=job_data.get("title", ""),
            lang=lang_code,
        )
