"""
CoverLetterGenerator — génère une lettre de motivation personnalisée
et la sauvegarde en TXT (texte brut, prêt à copier-coller).
"""

import anthropic
import os
import random
from pathlib import Path
from typing import Dict, Optional
from rich.console import Console
from user_profile import load_user_profile, candidate_block_for_letter, tone_block_for_letter
from job_language import language_from_analysis, language_labels
from text_sanitize import NO_DASH_RULE, NO_DASH_RULE_EN, strip_dashes

console = Console()

COVER_LETTER_USER = """Rédige une lettre de motivation courte pour {name}. Personnalisée pour CETTE offre précise.

{letter_reference_block}
{tone_block}

CANDIDAT (son vrai CV et profil — ne rien inventer) :
{candidate_block}

LE POSTE :
Entreprise : {company}
Ce qu'ils font : {company_description}
Intitulé : {title}
En résumé : {role_summary}
Ce qu'ils cherchent :
{responsibilities}

LANGUE OBLIGATOIRE : {letter_language} — toute la lettre doit être rédigée dans cette langue (celle de l'offre).

{variation_block}

RÈGLES :
- {no_dash_rule}
- {length_rule}
- Pas de formule d'appel ni de signature
- Pas de "Je reste à votre disposition"
- Mentionner uniquement des éléments présents dans le CV du candidat
- Le ton demandé et la lettre de référence (si fournie) priment sur le style par défaut
- N'utilise PAS une ouverture passe-partout : suis l'angle d'attaque indiqué ci-dessus

Retourne UNIQUEMENT le corps de la lettre."""

_LETTER_REFERENCE_BLOCK = """
=== LETTRE DE RÉFÉRENCE DU CANDIDAT (PRIORITÉ ÉLEVÉE) ===
Cette lettre a été écrite par le candidat pour une autre offre. C'est SA voix, SA façon d'écrire.

{letter_sample}

INSTRUCTIONS OBLIGATOIRES :
- Reproduire fidèlement le STYLE du candidat : longueur des phrases, registre, niveau de formalité, rythme
- Reprendre sa façon d'ouvrir et de clore (structure, pas le contenu)
- Reprendre son vocabulaire habituel et ses tournures caractéristiques
- Réécrire entièrement le FOND pour CETTE offre en {letter_language}
- Ne pas recopier de phrases mot pour mot, ne pas réutiliser le nom d'une autre entreprise
- Si conflit entre le ton demandé et la lettre de référence : combiner les deux (style du candidat + ton demandé)
"""

_NO_REFERENCE_TONE_ONLY = """
Adapte légèrement le ton à la culture de l'entreprise (startup décontractée vs grand groupe formel),
sans contredire le ton demandé ci-dessus.
"""


def _letter_reference_block(profile: Dict, letter_language: str) -> str:
    sample = (profile.get("letter_sample") or "").strip()
    if not sample:
        return ""
    return _LETTER_REFERENCE_BLOCK.format(
        letter_sample=sample[:6000],
        letter_language=letter_language,
    )


_OPENINGS_FR = [
    "Ouvre sur un résultat ou un chiffre concret de ton parcours, amené comme une anecdote, jamais comme un CV.",
    "Ouvre sur une observation précise et personnelle concernant l'entreprise, son produit ou son marché.",
    "Ouvre sur la tension ou le problème réel que ce poste doit résoudre, vu de l'intérieur.",
    "Ouvre sur une conviction que tu as forgée sur le terrain, puis relie-la directement à ce poste.",
    "Ouvre par une question directe et sincère sur le rôle, l'équipe ou un choix de l'entreprise.",
    "Ouvre sur un parallèle entre une situation précise que tu as vécue et ce que ce poste implique.",
    "Ouvre sur ce qui t'a fait t'arrêter sur cette offre en particulier, sans flatterie.",
]
_CLOSINGS_FR = [
    "Termine par une question ouverte qui invite à échanger.",
    "Termine par une phrase courte et factuelle sur ta disponibilité, sans formule toute faite.",
    "Termine sur une note de curiosité réelle (ce que tu aimerais creuser avec eux).",
    "Termine par une proposition concrète (un échange, un point précis à aborder ensemble).",
]
_RHYTHMS_FR = [
    "Structure : 3 paragraphes courts et nerveux.",
    "Structure : 2 paragraphes denses suivis d'une phrase d'ouverture isolée.",
    "Structure : un paragraphe d'accroche, un paragraphe de fond, une clôture brève.",
]

_OPENINGS_EN = [
    "Open on a concrete result or number from your track record, told like an anecdote, never like a resume.",
    "Open on a precise, personal observation about the company, its product or its market.",
    "Open on the real tension or problem this role has to solve, seen from the inside.",
    "Open on a conviction you built on the ground, then tie it directly to this role.",
    "Open with a direct, genuine question about the role, the team or a company choice.",
    "Open on a parallel between a specific situation you lived through and what this role involves.",
    "Open on what made you stop on this posting specifically, no flattery.",
]
_CLOSINGS_EN = [
    "Close with an open question that invites a conversation.",
    "Close with a short, factual line about your availability, no boilerplate.",
    "Close on a note of real curiosity (what you'd like to dig into with them).",
    "Close with a concrete suggestion (a chat, a specific point to cover together).",
]
_RHYTHMS_EN = [
    "Structure: 3 short, punchy paragraphs.",
    "Structure: 2 dense paragraphs followed by a single standalone opening line.",
    "Structure: one hook paragraph, one substance paragraph, a brief close.",
]


def _variation_directive(lang_code: str) -> str:
    """Choisit un angle d'attaque, un rythme et une clôture au hasard pour éviter
    que toutes les lettres se ressemblent."""
    if lang_code == "en":
        opening = random.choice(_OPENINGS_EN)
        rhythm = random.choice(_RHYTHMS_EN)
        closing = random.choice(_CLOSINGS_EN)
        return (
            "ANGLE FOR THIS LETTER (make it different from a generic cover letter):\n"
            f"- {opening}\n- {rhythm}\n- {closing}"
        )
    opening = random.choice(_OPENINGS_FR)
    rhythm = random.choice(_RHYTHMS_FR)
    closing = random.choice(_CLOSINGS_FR)
    return (
        "ANGLE D'ATTAQUE POUR CETTE LETTRE (la rendre différente d'une lettre type) :\n"
        f"- {opening}\n- {rhythm}\n- {closing}"
    )


def _length_rule(tone: str, lang: str) -> str:
    if tone == "concis":
        if lang == "en":
            return "Ultra-short: 3 sentences max, 80-100 words total"
        return "Ultra-court : 3 phrases max, 80-100 mots total"
    if lang == "en":
        return "2-3 short paragraphs, 120-150 words"
    return "2-3 courts paragraphes, 120-150 mots"


def _clean_letter(text: str) -> str:
    """Supprime les tirets/puces parasites qui font trop IA."""
    return strip_dashes(text)

# ── Prompt de génération ───────────────────────────────────────────────────────

COVER_LETTER_PROMPT = """Write a short cover letter for Gregoire Linée. Sound like a real person sending a direct message — not a candidate performing enthusiasm, not a template.

WHO HE IS:
Centrale Lille engineer. Built Gare ta Bécane alone for 3 years: B2B2C marketplace for motorcycle parking across France. €850k ARR, 30% margin, 10k+ users. Now doing AI/automation consulting for SMEs on the side. Wants a product/ops/automation role in Paris, 60-70k€. Codes (React, JS, Python, Supabase). Native French, fluent English.

THE JOB:
Company: {company}
What they do: {company_description}
Role: {title}
What it's really about: {role_summary}
Key things they need: {responsibilities}

WRITE IN: {letter_language}

{variation_block}

---

LENGTH: 2-3 short paragraphs. 120-150 words total. No greeting, no sign-off.

TONE REFERENCE — this is what good looks like:

"Running a two-sided marketplace solo taught me one thing fast: the operational backbone is what holds the commercial front together. Gare ta Bécane hit €850k ARR with 30% margin and 10k users — not because the product was elegant, but because the partner workflows didn't break under load.

What I see in this role is the same problem at a different scale: you're building something fast on a substrate that can't bend. That's the part I like working on.

Curious what the current bottleneck looks like from the inside. Happy to talk."

---

WHAT TO AVOID:
- Double hyphens (--), em dashes, en dashes, hyphens used as punctuation
- "Ayant passé trois ans à construire X, j'ai développé une solide expertise en Y"
- "Je suis particulièrement enthousiaste à l'idée de rejoindre votre équipe"
- "Mon expérience en X me permettrait de contribuer à Y"
- "Je reste disponible pour un entretien" / "n'hésitez pas à me contacter"
- "passionné par", "challenge", "opportunité unique", "thrilled", "excited to"
- Long sentences that try to say three things at once
- Generic observations that could apply to any company

WHAT TO DO:
- Open with ONE specific observation or situation — not a resume summary
- Mention the €850k / 30% / 10k numbers naturally in the first paragraph
- Second paragraph: one concrete connection between what he's done and what THEY need — use their own words lightly
- Close: a short, real sentence. A question. Something that opens a conversation, not closes a pitch.
- Each letter must feel like it's for THIS company specifically

Return ONLY the letter body. No subject line, no header, no signature."""


# ── Prompt PME/ETI — ton métier, pas startup ──────────────────────────────────
COVER_LETTER_PROMPT_PME = """Écris une lettre de motivation courte pour Grégoire Linée. Ton direct, professionnel, pas de langue de bois. Quelqu'un qui parle vrai, pas un candidat qui performe.

QUI IL EST :
Ingénieur Centrale Lille. A fondé et piloté Gare ta Bécane pendant 3 ans en solo : marketplace B2B2C de stationnement moto, 850k€ de CA, 30% de marge, 10k+ utilisateurs, 30+ partenaires (garages, parkings, collectivités). A géré de A à Z : commercial B2B, partenariats, organisation opérationnelle, recrutement prestataires, P&L. Aujourd'hui consultant automation/IA pour PME en parallèle. Cherche un poste de direction/pilotage des opérations sur Paris, 60-70k€.

CE QU'IL N'EST PAS : un profil tech SaaS ou startup. C'est quelqu'un qui a tenu une organisation complète, piloté des résultats concrets, géré des parties prenantes terrain.

LE POSTE :
Entreprise : {company}
Ce qu'ils font : {company_description}
Intitulé : {title}
Ce que le rôle implique vraiment : {role_summary}
Ce qu'ils cherchent : {responsibilities}

LANGUE : {letter_language}

{variation_block}

---

LONGUEUR : 2-3 courts paragraphes. 120-150 mots. Pas de formule d'appel, pas de signature.

RÉFÉRENCE DE TON — voilà ce qui marche :

"Diriger une activité B2B complète en solo, c'est apprendre vite que les opérations ne pardonnent pas. Chez Gare ta Bécane, on a atteint 850k€ de CA à 30% de marge non pas parce que le concept était bon, mais parce que le réseau de 30 partenaires tournait sans accroc et que les processus tenaient sous charge.

Ce que je lis dans ce poste, c'est exactement ça : une structure qui a besoin que quelqu'un prenne le cockpit des opérations, pas juste qu'il les coordonne. C'est le type de rôle où je suis utile.

Disponible pour en parler rapidement si ça correspond."

---

CE QU'IL FAUT ÉVITER :
- Doubles tirets (--), tirets cadratin, tirets utilisés comme ponctuation
- "Fort de mon expérience en X, je serais en mesure de..."
- "Je suis vivement intéressé par votre entreprise"
- "Mon parcours atypique me permettrait de..."
- "Je reste à votre disposition" / "N'hésitez pas à me contacter"
- "passionné par", "challenge", "opportunité unique", "dynamique", "rigoureux"
- Les tournures qui sonnent RH ou template
- Tout ce qui pourrait s'appliquer à une autre entreprise

CE QU'IL FAUT FAIRE :
- Ouvrir sur UNE situation ou observation concrète — pas un résumé de parcours
- Mentionner les 850k€ / 30% / 10k utilisateurs ou les 30 partenaires de façon naturelle
- Deuxième paragraphe : connexion directe entre ce qu'il a fait et ce qu'ILS cherchent — reprendre légèrement leurs mots
- Clore par une phrase courte, vraie. Une ouverture, pas une conclusion de pitch.
- Chaque lettre doit sentir qu'elle est pour CETTE entreprise spécifiquement

Retourne UNIQUEMENT le corps de la lettre. Pas d'objet, pas d'en-tête, pas de signature."""


class CoverLetterGenerator:
    def __init__(self, api_key: str, model: str = "claude-opus-4-6", pme_mode: bool = False,
                 profile: Optional[Dict] = None):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.model = model
        self.pme_mode = pme_mode
        self.profile = profile or load_user_profile(force=bool(os.environ.get("JA_USER_ID")))

    def generate_text(self, analysis: Dict, language: str = "auto") -> str:
        """Génère le texte brut de la lettre de motivation."""
        job = analysis.get("job", {})
        responsibilities = "\n".join(analysis.get("key_responsibilities", []))
        required_skills = ", ".join(analysis.get("required_skills", []))

        if language != "auto":
            lang_code = language if language in ("fr", "en") else "fr"
        else:
            lang_code, _ = language_labels(language_from_analysis(analysis))
        _, letter_language = language_labels(lang_code)
        tone = self.profile.get("letter_tone", "pro")
        no_dash = NO_DASH_RULE if lang_code == "fr" else NO_DASH_RULE_EN
        ref_block = _letter_reference_block(self.profile, letter_language)
        tone_block = tone_block_for_letter(tone, lang_code)
        if not ref_block:
            tone_block = f"{tone_block}\n{_NO_REFERENCE_TONE_ONLY}"
        variation_block = _variation_directive(lang_code)

        if self.profile.get("_source") == "user":
            prompt = COVER_LETTER_USER.format(
                name=self.profile.get("name", ""),
                candidate_block=candidate_block_for_letter(self.profile),
                tone_block=tone_block,
                letter_reference_block=ref_block,
                variation_block=variation_block,
                title=job.get("title", ""),
                company=job.get("company", ""),
                company_description=analysis.get("company_description", ""),
                role_summary=analysis.get("role_summary", ""),
                responsibilities=responsibilities,
                letter_language=letter_language,
                no_dash_rule=no_dash,
                length_rule=_length_rule(tone, lang_code),
            )
        else:
            if lang_code == "en":
                base_prompt = COVER_LETTER_PROMPT
            else:
                base_prompt = COVER_LETTER_PROMPT_PME
            prompt = base_prompt.format(
                title=job.get("title", ""),
                company=job.get("company", ""),
                company_description=analysis.get("company_description", ""),
                role_summary=analysis.get("role_summary", ""),
                responsibilities=responsibilities,
                required_skills=required_skills,
                why_interesting=analysis.get("why_interesting", ""),
                language=lang_code,
                letter_language=letter_language,
                variation_block=variation_block,
            )

        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                temperature=1.0,
                messages=[{"role": "user", "content": prompt}],
            )
            return _clean_letter(response.content[0].text.strip())
        except Exception as e:
            console.print(f"[red]  Cover letter error: {e}[/red]")
            return ""

    def save_txt(self, text: str, output_path: Path) -> Path:
        """Sauvegarde la lettre en texte brut (.txt), prêt à copier-coller."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(text, encoding="utf-8")
        return output_path

    def generate_and_save(self, analysis: Dict, output_path: Path, language: str = "auto") -> Optional[Path]:
        """Génère et sauvegarde la lettre en texte brut (.txt)."""
        text = self.generate_text(analysis, language)
        if not text:
            return None
        # Force l'extension .txt quelle que soit celle passée
        txt_path = output_path.with_suffix(".txt")
        return self.save_txt(text, txt_path)
