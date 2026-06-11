"""Nettoyage des tirets dans les textes générés (CV, lettres)."""
import re
from typing import Any

NO_DASH_RULE = (
    "INTERDIT dans tout le texte généré : doubles tirets (--), tirets cadratin (—), "
    "tirets demi-cadratin (–) et tout tiret utilisé comme ponctuation. "
    "Utilise des virgules ou des points. "
    "Seuls les tirets à l'intérieur d'un mot ou d'une expression (ex. B2B, React-Native) sont autorisés."
)

NO_DASH_RULE_EN = (
    "FORBIDDEN in all generated text: double hyphens (--), em dashes (—), en dashes (–), "
    "and any hyphen used as punctuation. Use commas or periods instead. "
    "Hyphens inside words or terms (e.g. B2B, React-Native) are allowed."
)


def strip_dashes(text: str) -> str:
    """Retire doubles tirets et tirets longs utilisés comme ponctuation."""
    if not text:
        return text
    text = text.replace("--", " ")
    text = text.replace("—", ", ")
    text = text.replace("–", ", ")
    text = re.sub(r"^\s*[-–—•]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+-\s+", " ", text)
    text = re.sub(r"(?<!\w)-(?!\w)", "", text)
    text = re.sub(r"\s+,", ",", text)
    text = re.sub(r",\s*,+", ", ", text)
    text = re.sub(r"  +", " ", text)
    return text.strip()


def strip_dashes_deep(value: Any) -> Any:
    """Applique strip_dashes récursivement sur str / list / dict."""
    if isinstance(value, str):
        return strip_dashes(value)
    if isinstance(value, list):
        return [strip_dashes_deep(v) for v in value]
    if isinstance(value, dict):
        return {k: strip_dashes_deep(v) for k, v in value.items()}
    return value
