"""Détection et normalisation de la langue d'une offre (fr/en)."""
from typing import Dict, Optional, Tuple

_EN_MARKERS = (
    " the ", " you will ", " we are looking", " requirements", " about the role",
    " full-time", " full time", " remote", " responsibilities", " qualifications",
    " years of experience", " apply now", " job description",
    " what you'll do", " what we're looking", " nice to have",
    " you have", " you are", " we offer", " join us", " our team",
)
_FR_MARKERS = (
    " nous recherchons", " vous serez", " le poste", " missions", " profil recherché",
    " cdi", " télétravail", " teletravail", " candidature", " votre mission",
    " descriptif", " compétences", " competences", " années d'expérience",
    " nous offrons", " rejoignez", " votre profil", " vos missions",
)

# Mots dans le TITRE suffisamment forts pour trancher seuls
_EN_TITLE_WORDS = ("manager", "engineer", "developer", "analyst", "lead", "head of",
                   "product", "growth", "operations", "senior", "junior", "intern",
                   "director", "designer", "scientist", "architect", "specialist")
_FR_TITLE_WORDS = ("responsable", "chargé", "chargee", "ingénieur", "ingenieur",
                   "directeur", "directrice", "analyste", "développeur", "developpeur",
                   "concepteur", "gestionnaire")


def normalize_language(lang: Optional[str]) -> str:
    if not lang:
        return "fr"
    code = str(lang).lower().strip()[:2]
    return "en" if code == "en" else "fr"


def _score_text(text: str) -> tuple[int, int]:
    """Retourne (en_score, fr_score) pour un texte donné."""
    en_score = sum(1 for m in _EN_MARKERS if m in text)
    fr_score = sum(1 for m in _FR_MARKERS if m in text)
    # Mots courants
    en_score += len([w for w in (" of ", " the ", " and ", " with ", " for ", " this ") if w in text])
    fr_score += len([w for w in (" de ", " des ", " les ", " une ", " pour ", " avec ") if w in text])
    return en_score, fr_score


def detect_job_language(job: Dict) -> str:
    """Heuristique robuste sur titre + description quand l'analyse n'a pas de langue fiable."""
    title = job.get("title", "").lower()
    description = job.get("description", "").lower()

    # Le titre seul peut suffire s'il contient des mots anglais typiques
    # ET pas de description — ou si c'est très clair
    title_en = sum(1 for w in _EN_TITLE_WORDS if w in title)
    title_fr = sum(1 for w in _FR_TITLE_WORDS if w in title)

    if not description.strip():
        # Sans description, se fier au titre
        if title_en > title_fr:
            return "en"
        return "fr"

    text = f"{title} {description}"
    en_score, fr_score = _score_text(text)

    # Bonus titre
    en_score += title_en
    fr_score += title_fr

    if en_score > fr_score:
        return "en"
    if fr_score > en_score:
        return "fr"
    return "fr"  # Tie → français par défaut


def language_from_analysis(analysis: Dict) -> str:
    """Détermine la langue de l'offre en combinant le champ stocké et le contenu réel.

    Le champ `language` stocké en base peut être incorrect (ex. description absente
    lors de l'analyse initiale → défaut "fr"). On cross-checke toujours avec le
    contenu du job si disponible.
    """
    job = analysis.get("job") or {}
    stored = normalize_language(analysis.get("language")) if analysis.get("language") else None

    # Si on a du contenu de job disponible, on vérifie
    has_content = bool(job.get("title") or job.get("description"))
    if has_content:
        content_lang = detect_job_language(job)
        # Si le champ stocké dit "fr" mais le contenu pointe "en", le contenu gagne
        if stored == "fr" and content_lang == "en":
            return "en"
        # Si pas de champ stocké, on utilise le contenu
        if not stored:
            return content_lang

    return stored or "fr"


def language_labels(lang: str) -> Tuple[str, str]:
    """(code fr|en, libellé French|English pour les prompts)."""
    code = normalize_language(lang)
    label = "English" if code == "en" else "French"
    return code, label
