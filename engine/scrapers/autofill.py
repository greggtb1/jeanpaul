"""
AutoFiller — remplit automatiquement les formulaires de candidature.

Utilise un profil navigateur persistant (~/.job-apply-browser) pour garder
la session LinkedIn entre les runs. La première fois, il faut se connecter
manuellement dans la fenêtre qui s'ouvre.

Modes :
  - fill(job, cv_path, letter_text)   : remplissage par sélecteurs (legacy)
  - smart_fill(job, cv_path, letter)  : remplissage piloté par Claude (multi-pages)
  - train(urls)                       : inspecte les champs sans rien soumettre
  - detect_ats(url)                   : identifie la plateforme ATS
"""

import re
import sys
import json
import time
import random
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, List, Tuple, Any
from rich.console import Console

console = Console()

# ── Profil navigateur persistant ─────────────────────────────────────────────
BROWSER_PROFILE = Path.home() / ".job-apply-browser"

# Dossier pour les captures d'écran de debug
DEBUG_DIR = Path.home() / ".job-apply-browser" / "debug"

# Bank de réponses générique réutilisable cross-applications
# (questions du genre "How did you hear", "Visa needed", "Years of experience"…)
ANSWER_BANK_FILE = Path.home() / ".job-apply-browser" / "answer_bank.json"

# Nom du fichier de cache des réponses dans chaque dossier de candidature
APP_ANSWERS_FILE = "autofill_answers.json"

# ── Données du candidat (remplies par sync_candidate_from_profile) ───────────
CANDIDATE: Dict[str, Any] = {
    "first_name": "",
    "last_name": "",
    "full_name": "",
    "email": "",
    "phone": "",
    "phone_intl": "",
    "phone_national": "",
    "phone_local": "",
    "website": "",
    "linkedin": "",
    "github": "",
    "address": "",
    "city": "",
    "postcode": "",
    "country": "France",
    "location": "",
    "nationality": "",
    "work_authorization_eu": True,
    "work_authorization_france": True,
    "needs_visa_sponsorship": False,
    "availability": "",
    "earliest_start_date": "",
    "salary_expectation": "",
    "salary_min": None,
    "salary_max": None,
    "currency": "EUR",
    "notice_period": "",
    "years_of_experience": None,
    "english_level": "Courant",
    "english_level_en": "Fluent",
    "french_level": "Natif",
    "french_level_en": "Native",
    "languages_fluent": ["French", "English"],
    "languages_fr": ["Français", "Anglais"],
    "consent_certify": "Yes",
    "consent_privacy": "Yes",
    "gender": "Prefer not to say",
    "ethnicity": "Prefer not to say",
    "disability": "No",
    "veteran_status": "I am not a protected veteran",
    "how_did_you_hear": "LinkedIn",
    "referred_by": "",
    "comfortable_commuting": True,
    "comfortable_hybrid": True,
    "has_masters_degree": False,
    "has_bachelors_degree": False,
    "remote_pref": [],
}


def _urls_from_cv_text(cv_text: str) -> Dict[str, str]:
    """Extrait LinkedIn / site web depuis le texte du CV uploadé."""
    out = {"linkedin": "", "website": ""}
    if not cv_text:
        return out
    m = re.search(r"https?://(?:www\.)?linkedin\.com/in/[\w\-%/]+", cv_text, re.I)
    if m:
        out["linkedin"] = m.group(0).rstrip("/.,;)")
    for m in re.finditer(r"https?://[^\s\)\]>\"']+", cv_text):
        u = m.group(0).rstrip(".,;)")
        if "linkedin.com" not in u.lower():
            out["website"] = u
            break
    if not out["website"]:
        dm = re.search(
            r"(?:^|\s)([\w\-]+\.(?:pro|com|io|fr|dev|me|net|org))(?:\s|$)",
            cv_text,
            re.I | re.M,
        )
        if dm:
            out["website"] = f"https://{dm.group(1)}"
    return out


def _parse_phone(raw: str) -> Dict[str, str]:
    """Normalise un numéro FR pour les formulaires (LinkedIn indicatif séparé, etc.)."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("33") and len(digits) >= 11:
        national = "0" + digits[2:11]
        local = digits[2:11]
    elif digits.startswith("0") and len(digits) >= 10:
        national = digits[:10]
        local = digits[1:10]
    elif len(digits) == 9:
        national = "0" + digits
        local = digits
    else:
        national = raw or ""
        local = digits[-9:] if len(digits) >= 9 else digits

    spaced = ""
    if len(local) == 9:
        spaced = f"+33 {local[0]} {local[1:3]} {local[3:5]} {local[5:7]} {local[7:9]}"
    return {
        "phone": spaced or raw or "",
        "phone_intl": f"+33{local}" if local else "",
        "phone_national": national or "",
        "phone_local": local or "",
    }


def _name_from_email_local(email: str) -> str:
    """Déduit 'Prenom Nom' depuis la partie locale d'un email (ex: adele.lambert@...)."""
    local = (email or "").split("@", 1)[0]
    if not local:
        return ""
    words = [w for w in re.split(r"[._\-+]+", local) if w and w.isalpha() and len(w) >= 2]
    if not words or len(words) > 4:
        return ""
    return " ".join(w[0].upper() + w[1:].lower() for w in words[:3])


def sync_candidate_from_profile() -> None:
    """Charge email/tél/nom depuis le profil Supabase (JA_USER_ID) dans CANDIDATE.

    Chaîne de fallbacks pour ne JAMAIS partir avec une identité vide :
      email : identité CV → email du compte
      nom   : profil/CV  → nom du compte → déduit de l'email
      tél   : profil/CV  → téléphone du compte
    """
    try:
        from user_profile import load_user_profile

        prof = load_user_profile(force=True)
        if prof.get("_source") != "user":
            return

        account_email = (prof.get("_account_email") or "").strip()
        account_name = (prof.get("_account_name") or "").strip()
        account_phone = (prof.get("_account_phone") or "").strip()

        email = (prof.get("email") or "").strip() or account_email
        name = (prof.get("name") or "").strip() or account_name or _name_from_email_local(email)
        phone_raw = (prof.get("phone") or "").strip() or account_phone

        if not name:
            console.print("  [yellow]Nom candidat manquant — renseignez-le dans Mon compte.[/yellow]")
        parts = name.split(" ", 1) if name else ["", ""]
        phone_bits = _parse_phone(phone_raw)

        locs = prof.get("target_locations") or []
        city_from_profile = str(locs[0]).strip() if isinstance(locs, list) and locs else ""

        location = (prof.get("location") or city_from_profile or "").strip()

        updates: Dict[str, Any] = {
            "first_name": parts[0],
            "last_name": parts[1] if len(parts) > 1 else "",
            "full_name": name,
            "email": email,
            "location": location,
            **phone_bits,
        }
        if city_from_profile:
            updates["city"] = city_from_profile
        elif location:
            updates["city"] = location.split(",")[0].split("(")[0].strip()

        if prof.get("website"):
            updates["website"] = str(prof["website"]).strip()
        cv_urls = _urls_from_cv_text(prof.get("cv_text") or "")
        if cv_urls["linkedin"]:
            updates["linkedin"] = cv_urls["linkedin"]
        if cv_urls["website"] and not updates.get("website"):
            updates["website"] = cv_urls["website"]
        sm = prof.get("salary_min")
        if sm:
            try:
                sm_i = int(sm)
                updates["salary_min"] = sm_i
                updates["salary_expectation"] = f"{sm_i}-{sm_i + 15}k EUR"
            except (TypeError, ValueError):
                pass
        if prof.get("tagline"):
            updates["tagline"] = prof["tagline"]
        if prof.get("cv_text"):
            updates["cv_summary"] = prof["cv_text"][:2500]
            cv_lower = prof["cv_text"].lower()
            if any(k in cv_lower for k in ("master", "mastère", "msc", "mba", "bac+5", "bac +5")):
                updates["has_masters_degree"] = True
            if any(k in cv_lower for k in ("licence", "bachelor", "bac+3", "bac +3")):
                updates["has_bachelors_degree"] = True

        try:
            from store import client

            uid = prof.get("_uid") or __import__("os").environ.get("JA_USER_ID")
            if uid:
                row = (
                    client()
                    .table("profiles")
                    .select("remote_pref,contract_type")
                    .eq("id", uid)
                    .maybe_single()
                    .execute()
                )
                pdata = row.data or {}
                rp = pdata.get("remote_pref")
                if isinstance(rp, list) and rp:
                    updates["remote_pref"] = [str(x).lower() for x in rp]
        except Exception:
            pass

        CANDIDATE.update({k: v for k, v in updates.items() if v is not None and v != ""})
        email_hint = CANDIDATE.get("email") or "email manquant"
        console.print(f"  [green]✓ Profil candidat : {name} · {email_hint}[/green]")
        missing = [
            k
            for k in ("email", "phone", "location")
            if not (CANDIDATE.get(k) or "").strip()
        ]
        if missing:
            console.print(
                f"  [yellow]⚠ Profil incomplet ({', '.join(missing)}) : certains champs ne seront pas remplis[/yellow]"
            )
    except Exception as e:
        console.print(f"  [dim]profil user : {str(e)[:60]}[/dim]")


def _linkedin_city_typeahead_query() -> Tuple[str, List[str]]:
    """Texte à taper + indices pour choisir une suggestion LinkedIn (ville)."""
    city = (CANDIDATE.get("city") or "").strip()
    loc = (CANDIDATE.get("location") or "").strip()
    raw = city or loc.split(",")[0].split("(")[0].strip()
    if not raw:
        raw = "Paris"
    hints = [raw]
    if loc and loc.split(",")[0].strip() not in hints:
        hints.append(loc.split(",")[0].strip())
    hints.append("France")
    return raw[:24], hints


def _is_city_like_field(label: str, placeholder: str = "") -> bool:
    blob = f"{label} {placeholder}".lower()
    return any(
        k in blob
        for k in (
            "ville", "city", "localité", "localite", "location",
            "lieu de résidence", "lieu de residence", "town",
        )
    ) and "country" not in blob and "pays" not in blob and "indicatif" not in blob


def _match_select_option_text(options: List[dict], targets: List[str]) -> Optional[str]:
    """Trouve le libellé exact d'une option <select> (match partiel insensible à la casse)."""
    texts = []
    for o in options or []:
        t = (o.get("t") if isinstance(o, dict) else str(o) or "").strip()
        if not t:
            continue
        tl = t.lower()
        if tl in ("sélectionnez une option", "select an option", "choose an option", "—"):
            continue
        texts.append(t)
    if not texts:
        return None
    for target in targets:
        if not target:
            continue
        tl = target.lower()
        for t in texts:
            if t.lower() == tl:
                return t
    for target in targets:
        tl = target.lower()
        for t in texts:
            if tl in t.lower() or t.lower() in tl:
                return t
    return None


def _language_level_targets(lang: str) -> List[str]:
    """Libellés LinkedIn probables pour le niveau de langue."""
    if "french" in lang or "français" in lang or "fran" in lang:
        lvl = (CANDIDATE.get("french_level_en") or "Native").lower()
        if lvl in ("native", "natif", "bilingual", "bilingue"):
            return [
                "Native or bilingual proficiency",
                "Natif ou bilingue",
                "Full professional proficiency",
                "Capacité professionnelle complète",
                CANDIDATE.get("french_level_en", "Native"),
                CANDIDATE.get("french_level", "Natif"),
            ]
        return [
            "Professional working proficiency",
            "Full professional proficiency",
            "Capacité professionnelle complète",
            CANDIDATE.get("french_level_en", "Fluent"),
            CANDIDATE.get("french_level", "Courant"),
        ]
    lvl = (CANDIDATE.get("english_level_en") or "Fluent").lower()
    if lvl in ("native", "bilingual"):
        return [
            "Native or bilingual proficiency",
            "Natif ou bilingue",
            CANDIDATE.get("english_level_en", "Native"),
        ]
    if lvl in ("fluent", "courant", "advanced", "professional"):
        return [
            "Professional working proficiency",
            "Full professional proficiency",
            "Capacité professionnelle complète",
            CANDIDATE.get("english_level_en", "Fluent"),
            CANDIDATE.get("english_level", "Courant"),
        ]
    return [
        "Limited working proficiency",
        "Capacité professionnelle limitée",
        "Conversational",
        CANDIDATE.get("english_level_en", "Conversational"),
    ]


def _yes_no_for_question(question: str) -> Optional[str]:
    q = (question or "").lower()
    if re.search(r"visa|sponsorship|sponsor", q):
        return "No" if not CANDIDATE.get("needs_visa_sponsorship") else "Yes"
    if re.search(r"authorized|authorised|legally.*work|autoris.*travaill|droit.*travaill", q):
        return "Yes"
    if re.search(r"commuting|commute|déplacer|deplacer|travel.*office|office.*location", q):
        return "Yes" if CANDIDATE.get("comfortable_commuting", True) else "No"
    if re.search(r"hybrid", q):
        prefs = [str(x).lower() for x in (CANDIDATE.get("remote_pref") or [])]
        if any(p in prefs for p in ("hybrid", "hybride", "remote", "onsite", "sur site", "présentiel")):
            return "Yes"
        return "Yes" if CANDIDATE.get("comfortable_hybrid", True) else "No"
    if re.search(r"remote|télétravail|teletravail|work from home|fully remote|100% remote", q):
        prefs = [str(x).lower() for x in (CANDIDATE.get("remote_pref") or [])]
        return "Yes" if any("remote" in p or "télé" in p for p in prefs) else "No"
    if re.search(r"master|mast[eè]re|mba|bac\+5|bac \+5", q):
        return "Yes" if CANDIDATE.get("has_masters_degree", True) else "No"
    if re.search(r"bachelor|licence|bac\+3|bac \+3|undergraduate", q):
        return "Yes" if CANDIDATE.get("has_bachelors_degree", True) else "No"
    if re.search(r"certif|information is (true|correct)|je certifie|privacy|rgpd|gdpr|consent", q):
        return "Yes"
    return None


def _radio_option_label(field: dict) -> str:
    lbl = (field.get("label") or "")
    if "→" in lbl:
        return lbl.split("→")[-1].strip()
    return (field.get("value") or lbl).strip()


def _find_radio_key(group: List[dict], answer: str) -> Optional[str]:
    want = answer.lower()
    for f in group:
        opt = _radio_option_label(f).lower()
        val = (f.get("value") or "").lower()
        if opt in (want, "oui" if want == "yes" else "non" if want == "no" else opt):
            return _field_key(f)
        if val in (want, "true" if want == "yes" else "false" if want == "no" else val):
            return _field_key(f)
        if want == "yes" and opt in ("yes", "oui", "true", "1"):
            return _field_key(f)
        if want == "no" and opt in ("no", "non", "false", "0"):
            return _field_key(f)
    return None


# Correspondance label/name/id → valeur CANDIDATE (sans Claude)
_IDENTITY_FIELD_RULES: List[Tuple[str, List[str]]] = [
    ("first_name", [
        r"first\s*name", r"pr[eé]nom", r"given\s*name", r"\bfname\b", r"vorname",
    ]),
    ("last_name", [
        r"last\s*name", r"nom\s*de\s*famille", r"^nom$", r"\bnom\b(?!.*complet)",
        r"surname", r"family\s*name", r"\blname\b", r"nachname",
    ]),
    ("full_name", [r"full\s*name", r"nom\s*complet", r"your\s*name", r"^name$"]),
    ("email", [r"e-?mail", r"courriel", r"adresse\s*mail"]),
    ("phone", [r"phone", r"t[eé]l[eé]phone", r"\bmobile\b", r"\btel\b", r"cell"]),
    ("linkedin", [r"linkedin"]),
    ("website", [r"website", r"portfolio", r"personal\s*site", r"\bsite\b", r"github"]),
    ("city", [r"^city$", r"^ville$", r"localit", r"^town$"]),
    ("location", [r"^location$", r"^lieu$", r"where.*live", r"city.*state"]),
    ("address", [r"^address$", r"^adresse$", r"street"]),
    ("postcode", [r"post\s*code", r"zip\s*code", r"code\s*postal"]),
    ("country", [r"^country$", r"^pays$"]),
]


def _candidate_value_for_field(field: dict) -> Optional[str]:
    """Mappe un champ formulaire à une valeur CANDIDATE via label/name/id."""
    label = (field.get("label") or "").strip()
    ph = (field.get("placeholder") or "").strip()
    name = (field.get("name") or "").strip()
    fid = (field.get("id") or "").strip()
    ftype = (field.get("type") or "").lower()
    tag = (field.get("tag") or "").lower()
    blob = f"{label} {ph} {name} {fid}".lower()
    blob = re.sub(r"\*+$", "", blob).strip()

    if ftype == "file" or tag == "input" and ftype == "file":
        if any(k in blob for k in ("resume", "curriculum", " cv", "cv ", "upload", "document")):
            return "__CV_FILE__"
    if tag == "textarea" and any(k in blob for k in (
        "cover letter", "lettre", "motivation", "message", "why", "pourquoi",
    )):
        return "__COVER_LETTER__"

    # Heuristiques sur name/id (Ashby: _systemfield_email, etc.)
    id_blob = f"{name} {fid}".lower()
    if "email" in id_blob:
        v = (CANDIDATE.get("email") or "").strip()
        return v or None
    if any(k in id_blob for k in ("firstname", "first_name", "first-name", "fname")):
        v = (CANDIDATE.get("first_name") or "").strip()
        return v or None
    if any(k in id_blob for k in ("lastname", "last_name", "last-name", "lname", "surname")):
        v = (CANDIDATE.get("last_name") or "").strip()
        return v or None
    if "phone" in id_blob or "tel" in id_blob or "mobile" in id_blob:
        v = (CANDIDATE.get("phone") or "").strip()
        return v or None
    if "linkedin" in id_blob:
        v = (CANDIDATE.get("linkedin") or "").strip()
        return v or None

    for cand_key, patterns in _IDENTITY_FIELD_RULES:
        for pat in patterns:
            if re.search(pat, blob, re.I):
                val = (CANDIDATE.get(cand_key) or "").strip()
                if val:
                    return val
                if cand_key == "full_name":
                    fn = (CANDIDATE.get("first_name") or "").strip()
                    ln = (CANDIDATE.get("last_name") or "").strip()
                    if fn and ln:
                        return f"{fn} {ln}"
                    return fn or ln or None
                if cand_key in ("city", "location"):
                    city = (CANDIDATE.get("city") or CANDIDATE.get("location") or "Paris").strip()
                    return city.split(",")[0].split("(")[0].strip() or None
                if cand_key == "country":
                    return (CANDIDATE.get("country") or "France").strip()
                break
    return None


def _apply_profile_rules(fields: List[dict]) -> Dict[str, str]:
    """Réponses déterministes (identité, langues, oui/non, diplômes) avant Claude."""
    mapping: Dict[str, str] = {}
    radio_by_name: Dict[str, List[dict]] = {}

    # 1. Identité (prénom, email, tel…) — ne dépend pas de Claude
    for f in fields:
        key = _field_key(f)
        if not key or key in mapping:
            continue
        val = _candidate_value_for_field(f)
        if val:
            mapping[key] = val

    for f in fields:
        key = _field_key(f)
        if not key:
            continue
        label = (f.get("label") or "").lower()
        ftype = f.get("type") or ""
        tag = f.get("tag") or ""

        if tag == "select" and f.get("options"):
            if re.search(r"proficiency in french|fran.cais|niveau.*fran", label):
                opt = _match_select_option_text(f["options"], _language_level_targets("french"))
                if opt:
                    mapping[key] = opt
            elif re.search(r"proficiency in english|anglais|niveau.*anglais|english level", label):
                opt = _match_select_option_text(f["options"], _language_level_targets("english"))
                if opt:
                    mapping[key] = opt

        if ftype == "radio":
            name = f.get("name") or key
            radio_by_name.setdefault(name, []).append(f)

    for _name, group in radio_by_name.items():
        question = (group[0].get("label") or "").split("→")[0].strip()
        answer = _yes_no_for_question(question)
        if not answer:
            continue
        rk = _find_radio_key(group, answer)
        if rk:
            mapping[rk] = answer

    return mapping

# ── Détection ATS ─────────────────────────────────────────────────────────────

ATS_PATTERNS = {
    "greenhouse":  [r"boards\.greenhouse\.io", r"grnh\.se", r"greenhouse\.io/jobs", r"job-boards\.greenhouse\.io"],
    "lever":       [r"jobs\.lever\.co", r"lever\.co/"],
    "ashby":       [r"jobs\.ashbyhq\.com", r"app\.ashbyhq\.com"],
    "workable":    [r"apply\.workable\.com", r"workable\.com/j/"],
    "wttj":        [r"welcometothejungle\.com"],
    "linkedin":    [r"linkedin\.com/jobs"],
    "teamtailor":  [r"teamtailor\.com", r"careers\.", r"\.teamtailor\.com"],
    "recruitee":   [r"recruitee\.com"],
    "smartrecruiters": [r"smartrecruiters\.com", r"jobs\.smartrecruiters\.com"],
    "taleo":       [r"taleo\.net"],
    "successfactors": [r"successfactors\.com", r"successfactors\.eu"],
    "workday":     [r"myworkdayjobs\.com", r"workday\.com/.*job", r"wd\d+\.myworkdayjobs\.com"],
    "personio":    [r"personio\.de", r"personio\.com", r"jobs\.personio"],
    "bamboohr":    [r"bamboohr\.com/careers", r"bamboohr\.com/jobs"],
    "jobvite":     [r"jobvite\.com", r"jobs\.jobvite\.com"],
    "icims":       [r"icims\.com", r"careers-.*\.icims\.com"],
    "breezy":      [r"breezy\.hr"],
    "rippling":    [r"rippling-ats\.com", r"ats\.rippling\.com"],
    "join":        [r"join\.com/companies", r"join\.com/jobs"],
}

def detect_ats(url: str) -> str:
    """Identifie la plateforme ATS depuis une URL."""
    if not url:
        return "unknown"
    for ats, patterns in ATS_PATTERNS.items():
        for p in patterns:
            if re.search(p, url, re.IGNORECASE):
                return ats
    return "unknown"


def detect_ats_page(page) -> str:
    """Détecte l'ATS depuis l'URL de la page et de ses iframes."""
    try:
        ats = detect_ats(page.url or "")
        if ats != "unknown":
            return ats
        for fr in page.frames:
            try:
                fa = detect_ats(fr.url or "")
                if fa != "unknown":
                    return fa
            except Exception:
                continue
    except Exception:
        pass
    return "unknown"


# ATS où le formulaire est typiquement déjà sur la page (pas de clic d'entrée)
ATS_INLINE_FORM = {"greenhouse", "lever", "ashby", "smartrecruiters", "taleo", "workday", "icims"}

# LinkedIn : sélecteurs séparés Easy Apply vs Postuler externe
LINKEDIN_APPLY_SELECTORS_EASY = [
    "button.jobs-apply-button:has-text('Candidature simplifiée')",
    "button.jobs-apply-button:has-text('Candidature simplifié')",
    "button.jobs-apply-button:has-text('Postuler facilement')",
    "button.jobs-apply-button:has-text('Easy Apply')",
    "button[aria-label*='Candidature simplifiée' i]",
    "button[aria-label*='Candidature simplifi' i]",
    "button[aria-label*='Simplified application' i]",
    "button[aria-label*='Postuler facilement' i]",
    "button[aria-label*='Easy Apply' i]",
    "button.jobs-apply-button:not(.jobs-apply-button--external)",
    "a.jobs-apply-button:not(.jobs-apply-button--external)",
]

LINKEDIN_APPLY_SELECTORS_EXTERNAL = [
    "button.jobs-apply-button--external",
    "a.jobs-apply-button--external",
    "button:has(#link-external-medium)",
    "button:has(svg[id*='link-external'])",
    "a:has(#link-external-medium)",
    "button.jobs-apply-button:has-text('Postuler')",
    "a.jobs-apply-button:has-text('Postuler')",
    "button[aria-label*='Postuler' i]:not([aria-label*='similaire' i]):not([aria-label*='facilement' i])",
    "button[aria-label*='Apply' i]:not([aria-label*='Easy' i]):not([aria-label*='similar' i])",
    "button.jobs-apply-button",
    "a.jobs-apply-button",
]


# ── Sélecteurs pour le bouton "Postuler" / "Apply" ─────────────────────────────

APPLY_BUTTON_SELECTORS = {
    "linkedin": LINKEDIN_APPLY_SELECTORS_EASY + LINKEDIN_APPLY_SELECTORS_EXTERNAL,
    "wttj": [
        # Candidature spontanée en priorité
        "a:has-text('Postuler spontanément')",
        "button:has-text('Postuler spontanément')",
        "a:has-text('Candidature spontanée')",
        "button:has-text('Candidature spontanée')",
        "a:has-text('Open application')",
        "button:has-text('Open application')",
        "a:has-text('Spontaneous application')",
        "button:has-text('Spontaneous application')",
        "a[href*='spontan']",
        # Candidature sur offre publiée
        "a[data-testid*='apply' i]",
        "button[data-testid*='apply' i]",
        "a:has-text('Postuler')",
        "button:has-text('Postuler')",
        "a:has-text('Candidater')",
        "button:has-text('Candidater')",
        "a:has-text('Apply')",
        "button:has-text('Apply')",
    ],
    "workable": [
        "a:has-text('Apply for this job')",
        "button:has-text('Apply for this job')",
        "a:has-text('Apply now')",
        "button:has-text('Apply now')",
        "a:has-text('Apply')",
        "button:has-text('Apply')",
        "a:has-text('Postuler')",
    ],
    "teamtailor": [
        "a:has-text('Apply for this job')",
        "button:has-text('Apply for this job')",
        "a:has-text('Apply for the job')",
        "a:has-text('Apply now')",
        "button:has-text('Apply now')",
        "a:has-text('Postuler à cette offre')",
        "a:has-text('Postuler à ce poste')",
        "a:has-text('Candidater à ce poste')",
        "a:has-text('Postuler')",
        "button:has-text('Postuler')",
        "a:has-text('Apply')",
        "button:has-text('Apply')",
        "[data-tracking-id*='apply' i]",
    ],
    "recruitee": [
        "a:has-text('Apply for this job')",
        "a:has-text('Postuler')",
    ],
    "workday": [
        "a[data-automation-id='jobPostingApplyButton']",
        "button[data-automation-id='jobPostingApplyButton']",
        "a:has-text('Apply')",
        "button:has-text('Apply')",
        "a:has-text('Postuler')",
        "button:has-text('Postuler')",
    ],
    "personio": [
        "a:has-text('Apply')",
        "button:has-text('Apply')",
        "a:has-text('Postuler')",
        "button:has-text('Postuler')",
        "a:has-text('Jetzt bewerben')",
    ],
    "successfactors": [
        "button:has-text('Apply')",
        "a:has-text('Apply')",
        "button:has-text('Postuler')",
        "a:has-text('Postuler')",
    ],
    "_generic": [
        # Spécifiques en premier (évite que "Apply" générique clique le mauvais bouton)
        "button:has-text('Apply for this Job')",
        "a:has-text('Apply for this Job')",
        "button:has-text('Apply for this job')",
        "a:has-text('Apply for this job')",
        "button:has-text('Postuler à cette offre')",
        "a:has-text('Postuler à cette offre')",
        "button:has-text('Postuler pour ce poste')",
        "a:has-text('Postuler pour ce poste')",
        # Onglets "Application" (pages Alan, Ashby perso, etc.)
        "[role='tab']:has-text('Application')",
        "[role='tab']:has-text('Postuler')",
        "[role='tab']:has-text('Candidater')",
        "nav a:has-text('Application')",
        "nav button:has-text('Application')",
        # Génériques
        "button:has-text('Postuler')",
        "a:has-text('Postuler')",
        "button:has-text('Candidater')",
        "a:has-text('Candidater')",
        "button:has-text('Apply now')",
        "a:has-text('Apply now')",
        "button:has-text('Apply')",
        "a:has-text('Apply')",
        "[data-testid*='apply' i]",
        "[id*='apply' i]:not(form)",
    ],
}

# Labels/placeholders qui indiquent un champ poubelle (chrome de la page,
# pas un champ du formulaire de candidature)
JUNK_FIELD_TOKENS = (
    "rechercher", "search", "chercher",
    "choisir une langue", "choose a language", "select language", "language picker",
    "newsletter", "abonnez", "subscribe",
)

def _field_key(field: dict) -> str:
    """
    Génère une clé unique pour un champ.
    - Si id présent → id
    - Sinon, pour radio/checkbox sans id mais avec name+value → name::value
      (permet de distinguer chaque option d'un groupe radio)
    - Sinon → name
    Retourne "" si aucune clé identifiable.
    """
    fid = field.get("id") or ""
    if fid:
        return fid
    name = field.get("name") or ""
    ftype = field.get("type") or ""
    fval = field.get("value") or ""
    if name and fval and ftype in ("radio", "checkbox"):
        return f"{name}::{fval}"
    if name:
        return name
    label = (field.get("label") or field.get("placeholder") or "").strip()
    if label:
        slug = _normalize_question(label)
        if slug:
            return f"lbl::{slug[:72]}"
    return ""


def _normalize_question(label: str) -> str:
    """Normalise un label de question pour le cache cross-applications."""
    if not label:
        return ""
    s = label.lower().strip()
    s = re.sub(r"[\s*]+", " ", s)
    s = re.sub(r"[^\w\s]", "", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s).strip()
    # Tronque à 80 chars (les questions très longues finissent souvent par des
    # variantes mineures qu'on veut quand même matcher)
    return s[:80]


def _load_answer_bank() -> dict:
    """Charge le bank de réponses cross-applications."""
    try:
        if ANSWER_BANK_FILE.exists():
            return json.loads(ANSWER_BANK_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_answer_bank(bank: dict):
    try:
        ANSWER_BANK_FILE.parent.mkdir(parents=True, exist_ok=True)
        ANSWER_BANK_FILE.write_text(
            json.dumps(bank, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as e:
        console.print(f"  [yellow]⚠ save answer bank : {e}[/yellow]")


def _load_app_answers(app_dir: Optional[Path]) -> dict:
    """
    Charge le cache des réponses pour une candidature donnée.
    Retourne {key: value, ...} où key = id ou name du champ.
    """
    if not app_dir:
        return {}
    f = app_dir / APP_ANSWERS_FILE
    if not f.exists():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        out = {}
        for entry in data.get("answers", []):
            k = entry.get("key")
            v = entry.get("value")
            if k is not None and v is not None and v != "":
                out[k] = v
        return out
    except Exception as e:
        console.print(f"  [yellow]⚠ lecture cache : {e}[/yellow]")
        return {}


def _save_app_answers(app_dir: Optional[Path], job: dict, mapping: dict, fields: list):
    """
    Sauvegarde la mapping (key → value) dans <app_dir>/autofill_answers.json,
    avec le label de chaque champ pour rendre le fichier éditable à la main.
    Fait un merge avec ce qui existe déjà (n'écrase pas les clés non présentes).
    """
    if not app_dir:
        return
    f = app_dir / APP_ANSWERS_FILE
    # Charge existant
    existing = {}
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            for entry in data.get("answers", []):
                k = entry.get("key")
                if k:
                    existing[k] = entry
        except Exception:
            pass

    # Construit l'index label par key
    label_by_key = {}
    for fl in fields:
        for k in (fl.get("id"), fl.get("name")):
            if k and k not in label_by_key:
                lbl = (fl.get("label") or fl.get("placeholder") or "").strip().replace("\n", " ")
                label_by_key[k] = lbl[:120]

    # Merge
    for k, v in mapping.items():
        existing[k] = {
            "key":   k,
            "label": label_by_key.get(k, ""),
            "value": v,
        }

    # Sérialise
    payload = {
        "company": job.get("company", "") if job else "",
        "title":   job.get("title", "")   if job else "",
        "url":     job.get("url", "")     if job else "",
        "answers": list(existing.values()),
    }
    try:
        f.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        console.print(f"  [yellow]⚠ save cache : {e}[/yellow]")


def _is_junk_field(field: dict) -> bool:
    lbl = (field.get("label") or "").strip().lower()
    ph  = (field.get("placeholder") or "").strip().lower()
    fid = (field.get("id") or "").lower()
    if not lbl and not ph:
        # Pas de label : on garde, l'IA tranchera
        return False
    text = lbl + " " + ph + " " + fid
    return any(tok in text for tok in JUNK_FIELD_TOKENS)


# ── Bannières cookies (à fermer avant tout) ───────────────────────────────────

COOKIE_ACCEPT_SELECTORS = [
    # IDs spécifiques connus
    "#onetrust-accept-btn-handler",
    "#didomi-notice-agree-button",
    "button#CybotCookiebotDialogBodyLevelButtonAccept",
    "button#CybotCookiebotDialogBodyButtonAccept",
    "button#truste-consent-button",
    "button[data-cookieconsent='accept']",
    "button[data-tracking-id='cookies-accept-all']",
    # Texte (FR)
    "button:has-text('Tout accepter')",
    "button:has-text('Accepter tout')",
    "button:has-text(\"Tout accepter et fermer\")",
    "button:has-text(\"J'accepte tout\")",
    "button:has-text(\"J'accepte\")",
    "button:has-text('Accepter')",
    "button:has-text('OK pour moi')",
    # Texte (EN)
    "button:has-text('Accept all')",
    "button:has-text('Accept All')",
    "button:has-text('Allow all')",
    "button:has-text('Allow All')",
    "button:has-text('Agree')",
    "button:has-text('Got it')",
    "button:has-text('I accept')",
    # Liens
    "a:has-text('Tout accepter')",
    "a:has-text('Accept all')",
]


# ── Sélecteurs génériques pour fill() (legacy) ────────────────────────────────

FIELD_SELECTORS = {
    "first_name": [
        "input[name*='first'][type!='hidden']",
        "input[placeholder*='rénom' i]",
        "input[placeholder*='first' i]",
        "input[id*='first' i][type='text']",
        "input[aria-label*='first' i]",
        "input[autocomplete='given-name']",
    ],
    "last_name": [
        "input[name*='last'][type!='hidden']",
        "input[placeholder*='nom' i]:not([placeholder*='pré' i])",
        "input[placeholder*='last' i]",
        "input[id*='last' i][type='text']",
        "input[aria-label*='last' i]",
        "input[autocomplete='family-name']",
    ],
    "email": [
        "input[type='email']",
        "input[name*='email' i]",
        "input[placeholder*='email' i]",
        "input[autocomplete='email']",
    ],
    "phone": [
        "input[type='tel']",
        "input[name*='phone' i]",
        "input[name*='tel' i]",
        "input[placeholder*='téléphone' i]",
        "input[placeholder*='phone' i]",
        "input[autocomplete='tel']",
    ],
    "linkedin": [
        "input[name*='linkedin' i]",
        "input[placeholder*='linkedin' i]",
        "input[aria-label*='linkedin' i]",
        "input[id*='linkedin' i]",
    ],
    "website": [
        "input[name*='website' i]",
        "input[name*='portfolio' i]",
        "input[placeholder*='portfolio' i]",
        "input[placeholder*='website' i]",
        "input[placeholder*='site' i]",
    ],
    "cover_letter": [
        "textarea[name*='cover' i]",
        "textarea[name*='letter' i]",
        "textarea[name*='motivation' i]",
        "textarea[placeholder*='lettre' i]",
        "textarea[placeholder*='cover' i]",
        "textarea[placeholder*='motivation' i]",
        "div[contenteditable='true'][aria-label*='cover' i]",
        "div[contenteditable='true'][aria-label*='lettre' i]",
    ],
    "cv_upload": [
        "input[type='file'][accept*='pdf' i]",
        "input[type='file'][name*='resume' i]",
        "input[type='file'][name*='cv' i]",
        "input[type='file']",
    ],
}


# ── Boutons de navigation ─────────────────────────────────────────────────────

NEXT_SELECTORS = [
    "button:has-text('Suivant')",
    "button:has-text('Next')",
    "button:has-text('Continuer')",
    "button:has-text('Continue')",
    "button:has-text('Étape suivante')",
    "button:has-text('Next step')",
    "button[aria-label*='Suivant' i]",
    "button[aria-label*='Continue to next step' i]",
    "button[aria-label*='Next' i]",
    "[role='dialog'] button.artdeco-button--primary:has-text('Suivant')",
    "[role='dialog'] button.artdeco-button--primary:has-text('Next')",
    "input[type='submit'][value*='Next' i]",
    "input[type='submit'][value*='Suivant' i]",
]

LINKEDIN_CV_UPLOAD_TRIGGERS = [
    # Bouton LinkedIn Easy Apply « Importer le CV » (artdeco, texte parfois dans des spans)
    "[role='dialog'] button.artdeco-button:has-text('Importer le CV')",
    "[role='dialog'] button.artdeco-button--secondary:has-text('Importer')",
    "button.artdeco-button:has-text('Importer le CV')",
    "button.artdeco-button--secondary:has-text('Importer le CV')",
    "button:has-text('Importer le CV')",
    "button:has-text('Importer un CV')",
    "button:has-text('Téléverser le CV')",
    "button:has-text('Ajouter un CV')",
    "button:has-text('Upload resume')",
    "button:has-text('Change resume')",
    "button:has-text('Replace resume')",
    "button:has-text('Upload CV')",
    "button:has-text('Change CV')",
    "button:has-text('Télécharger un CV')",
    "button:has-text('Remplacer')",
    "button:has-text('Ajouter')",
    "span:has-text('Importer le CV')",
    "span:has-text('Upload resume')",
    "span:has-text('Télécharger un CV')",
    "a:has-text('Importer le CV')",
    "a:has-text('Upload resume')",
    "a:has-text('Télécharger un CV')",
    "label:has-text('Importer le CV')",
    "label:has-text('Importer un CV')",
    "button[aria-label*='Importer le CV' i]",
    "button[aria-label*='Importer un CV' i]",
    "button[aria-label*='Upload resume' i]",
    "button[aria-label*='Importer' i]",
    "button[aria-label*='Télécharger' i]",
    "button[aria-label*='Add resume' i]",
    ".jobs-document-upload-redesign-card__upload-button",
    ".jobs-document-upload__upload-button",
    "[data-test-id='resume-upload-button']",
]

JS_LINKEDIN_CLICK_CV_IMPORT = """
(root) => {
    root = root || document;
    const re = /importer\\s+(le|un)\\s+cv|upload\\s+resume|télécharger\\s+un\\s+cv|téléverser/i;
    const sel = 'button, a[role="button"], label, span[role="button"], [role="button"]';
    for (const el of root.querySelectorAll(sel)) {
        const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
        if (!re.test(t)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.click();
        return t.slice(0, 80);
    }
    return '';
}
"""

JS_DISMISS_LINKEDIN_SAVE_DRAFT = """
() => {
    const markers = /enregistrer cette candidature|save this application/i;
    const roots = document.querySelectorAll(
        '[role="dialog"], .artdeco-modal, .jobs-apply-modal, .artdeco-modal__content'
    );
    const hits = [];
    for (const dlg of roots) {
        const t = (dlg.innerText || dlg.textContent || '').replace(/\\s+/g, ' ');
        if (!markers.test(t)) continue;
        const r = dlg.getBoundingClientRect();
        if (r.width < 40 || r.height < 40) continue;
        const st = getComputedStyle(dlg);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
        hits.push({ dlg, area: r.width * r.height });
    }
    hits.sort((a, b) => b.area - a.area);
    for (const { dlg } of hits) {
        const dismiss = dlg.querySelector(
            'button.artdeco-modal__dismiss, button[data-test-modal-close-btn], ' +
            'button[aria-label*="Dismiss" i], button[aria-label*="Fermer" i], ' +
            'button[aria-label*="Close" i], button[aria-label*="Ignorer" i]'
        );
        if (dismiss) { dismiss.click(); return 'dismiss'; }
        for (const b of dlg.querySelectorAll('button')) {
            const bt = (b.innerText || b.textContent || '').trim();
            if (/^abandonner$|^discard$|^ne pas enregistrer$/i.test(bt)) { b.click(); return 'abandon'; }
        }
        // Dernier recours : clic sur la croix du dialog parent
        const parentDlg = dlg.closest('[role="dialog"]');
        if (parentDlg) {
            const x = parentDlg.querySelector('button[aria-label*="Fermer" i], button[aria-label*="Close" i], button[aria-label*="Dismiss" i], button.artdeco-modal__dismiss');
            if (x) { x.click(); return 'close'; }
        }
    }
    return '';
}
"""

JS_LINKEDIN_CLICK_POSTULER = """
(root, preferExternal) => {
    root = root || document;
    preferExternal = !!preferExternal;
    const bad = '.jobs-similar-jobs, .jobs-you-might-like, .discovery-results, '
        + '.job-card-container, .jobs-search-results-list, aside.scaffold-layout__aside';
    const nodes = root.querySelectorAll(
        'button.jobs-apply-button, a.jobs-apply-button, button, a[role="button"]'
    );
    const candidates = [];
    for (const el of nodes) {
        if (el.closest(bad)) continue;
        const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '')
            .replace(/\\s+/g, ' ').trim();
        const tl = t.toLowerCase();
        const cls = (el.className || '').toString();
        const easy = /candidature simplifi|easy apply|postuler facilement|simplified application/.test(tl);
        const external = /^postuler$/.test(tl) || /^apply$/.test(tl);
        const extIcon = !!el.querySelector('svg[id*="link-external"], #link-external-medium');
        const applyBtn = cls.includes('jobs-apply-button');
        const isExternal = cls.includes('jobs-apply-button--external') || extIcon
            || (external && applyBtn);
        const isEasy = easy || (applyBtn && !isExternal);
        if (!isEasy && !isExternal && !applyBtn) continue;
        if (/similaire|similar|offres similaires/.test(tl)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden' || st.display === 'none') continue;
        candidates.push({ el, t, isExternal, isEasy });
    }
    candidates.sort((a, b) => {
        if (preferExternal) return (b.isExternal ? 1 : 0) - (a.isExternal ? 1 : 0);
        return (b.isEasy ? 1 : 0) - (a.isEasy ? 1 : 0);
    });
    for (const { el, t } of candidates) {
        el.scrollIntoView({ block: 'center', inline: 'nearest' });
        el.click();
        return t.slice(0, 80);
    }
    return '';
}
"""

REVIEW_SELECTORS = [
    "button:has-text('Vérifier')",
    "button:has-text('Review')",
    "button:has-text('Review your application')",
    "button[aria-label*='Review' i]",
]

SUBMIT_SELECTORS = [
    "button:has-text('Soumettre la candidature')",
    "button:has-text('Submit application')",
    "button:has-text('Submit Application')",
    "button:has-text('Soumettre')",
    "button:has-text('Submit')",
    "button:has-text('Envoyer ma candidature')",
    "button:has-text('Envoyer la candidature')",
    "button[aria-label*='Envoyer la candidature' i]",
    "button[aria-label*='Envoyer ma candidature' i]",
    "button[aria-label*='Soumettre la candidature' i]",
    "button[aria-label*='Submit application' i]",
    "[role='dialog'] button.artdeco-button--primary:has-text('Envoyer')",
    "[role='dialog'] button.artdeco-button--primary:has-text('Soumettre')",
    "button[data-testid*='submit' i]",
    "button[type='submit']:has-text('Apply')",
    "input[type='submit'][value*='Submit' i]",
    "input[type='submit'][value*='Soumettre' i]",
    "input[type='submit'][value*='Envoyer' i]",
]

SUBMIT_BUTTON_NAME_RE = re.compile(
    r"(envoyer la candidature|envoyer ma candidature|soumettre la candidature|"
    r"submit application|soumettre|submit)",
    re.I,
)


# ── JS helpers (utilisés via page.evaluate) ────────────────────────────────────

# Dispatche les events que React/Vue/Angular écoutent après un .fill()
JS_DISPATCH_REACT_EVENTS = """
(el) => {
    if (!el) return;
    const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : (el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) {
        setter.set.call(el, el.value);
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur',   { bubbles: true }));
}
"""

# Extraction des champs visibles + métadonnées riches
# Utilisé via:
#   page/frame.evaluate(JS_EXTRACT_FIELDS, None)  → root = document
#   locator.evaluate(JS_EXTRACT_FIELDS)           → root = élément matché (dialog)
JS_EXTRACT_FIELDS = """
(root) => {
    root = root || document;

    function getGroupLabel(el) {
        // Pour radios/checkboxes : cherche le label de la fieldset/question parente
        let p = el.parentElement;
        for (let i = 0; i < 10 && p; i++, p = p.parentElement) {
            const cls = (p.className || '').toString();
            if (cls.includes('jobs-easy-apply-form-section__group') ||
                cls.includes('fb-dash-form-element')) {
                const ql = p.querySelector(
                    '.jobs-easy-apply-form-section__label, ' +
                    '.jobs-easy-apply-form-section__title, ' +
                    'label, span.t-14'
                );
                if (ql && !ql.contains(el)) {
                    const t = (ql.innerText || '').trim();
                    if (t && t.length < 300) return t;
                }
            }
            if (p.tagName === 'FIELDSET') {
                const lg = p.querySelector(':scope > legend');
                if (lg) return (lg.innerText || '').trim();
            }
            // Heuristique : div avec une question label
            if (p.classList && (p.classList.contains('form-group') ||
                p.classList.contains('field') || p.classList.contains('question'))) {
                const cl = p.querySelector('label, .label, h3, .question-text');
                if (cl && !cl.contains(el)) {
                    const t = (cl.innerText || '').trim();
                    if (t && t.length < 200) return t;
                }
            }
        }
        return '';
    }

    function getLabel(el) {
        if (el.id) {
            try {
                const lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
                if (lbl) return lbl.innerText.trim();
            } catch (e) {}
        }
        const aria = el.getAttribute('aria-label');
        if (aria && aria.trim()) return aria.trim();
        const lblId = el.getAttribute('aria-labelledby');
        if (lblId) {
            const parts = lblId.split(/\\s+/).map(id => {
                const e = document.getElementById(id);
                return e ? (e.innerText || '').trim() : '';
            }).filter(Boolean);
            if (parts.length) return parts.join(' ');
        }
        // <label> ancêtre direct (cas <label>Nom <input/></label>)
        let p = el.parentElement;
        for (let i = 0; i < 5 && p; i++, p = p.parentElement) {
            if (p.tagName === 'LABEL') return (p.innerText || '').trim();
        }
        // Texte d'un élément sibling précédent (legend, h2, .label, span, div)
        let prev = el.previousElementSibling;
        for (let i = 0; i < 3 && prev; i++, prev = prev.previousElementSibling) {
            const t = (prev.innerText || '').trim();
            if (t && t.length < 200) return t;
        }
        // Remonte d'un cran et regarde le sibling précédent du parent
        // (couvre les structures <div class="form-group"><label>X</label><div><input/></div></div>)
        const parent = el.parentElement;
        if (parent) {
            let pprev = parent.previousElementSibling;
            for (let i = 0; i < 2 && pprev; i++, pprev = pprev.previousElementSibling) {
                if (pprev.tagName === 'LABEL') {
                    const t = (pprev.innerText || '').trim();
                    if (t) return t;
                }
            }
            // Cherche un label DANS le même bloc parent, qui ne référence pas un autre champ
            const candidates = parent.querySelectorAll('label, .label, [class*="label"]');
            for (const c of candidates) {
                const forAttr = c.getAttribute('for');
                if (forAttr && forAttr !== el.id) continue;
                if (c.contains(el) || c === el) continue;
                const t = (c.innerText || '').trim();
                if (t && t.length < 200) return t;
            }
        }
        // ── React Select / Greenhouse : remonte la hiérarchie select__ ──
        // Structure typique : input[aria-labelledby="X-label"] dans
        // .select__input-container > .select__value-container > .select__control
        // > .select__container > .field-wrapper > label#X-label
        // → la remontée parentElement classique ne suffit pas ; on cherche dans l'ancêtre
        {
            let p = el.parentElement;
            for (let i = 0; i < 10 && p; i++, p = p.parentElement) {
                // Cherche un label ou span question DANS ce bloc (pas descendant du champ)
                const lbls = p.querySelectorAll(
                    'label:not([for]), label[for="' + (el.id||'__none__') + '"], ' +
                    'span[class*="label"], div[class*="label"], ' +
                    'legend, h3, h4, [class*="question-label"], [class*="field-label"]'
                );
                for (const lb of lbls) {
                    if (lb.contains(el)) continue;
                    const t = (lb.innerText || '').trim();
                    if (t && t.length >= 3 && t.length < 300) return t;
                }
                // Stop dès qu'on atteint un conteneur de formulaire connu
                const cls = (p.className || '').toString();
                if (cls.includes('application') || cls.includes('form-body') ||
                    p.tagName === 'FORM') break;
            }
        }
        // Ashby / ATS modernes : label dans le conteneur de champ
        {
            let p = el.closest(
                '[class*="fieldEntry"], [class*="field-entry"], [class*="FieldEntry"], ' +
                '[class*="ashby"], [data-testid*="field"]'
            ) || el.parentElement;
            for (let i = 0; i < 6 && p; i++, p = p.parentElement) {
                const lbl = p.querySelector(
                    'label, [class*="label" i]:not(input):not(textarea):not(select), ' +
                    '[class*="Label"]:not(input):not(textarea):not(select)'
                );
                if (lbl && !lbl.contains(el)) {
                    const t = (lbl.innerText || '').replace(/\\*+$/, '').trim();
                    if (t && t.length >= 2 && t.length < 200) return t;
                }
            }
        }
        return el.placeholder || '';
    }

    function isVisible(el) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        return true;
    }

    const stdEls = Array.from(root.querySelectorAll(
        'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]),' +
        'textarea, select'
    ));

    // Champs rich-text : role=textbox (Workday, SAP, Taleo…)
    // et contenteditable=true (BambooHR, Beamery…)
    const roleTextboxEls = Array.from(root.querySelectorAll(
        '[role="textbox"]:not(input):not(textarea),' +
        '[contenteditable="true"]:not([role="document"]):not(body)'
    )).filter(el => isVisible(el));

    // Champs date custom (Workday utilise des divs role=spinbutton)
    const spinEls = Array.from(root.querySelectorAll(
        '[role="spinbutton"]:not(input)'
    )).filter(el => isVisible(el));

    const els = [...stdEls, ...roleTextboxEls, ...spinEls];

    // Inclus tous les file inputs même cachés (display:none derrière un bouton custom),
    // ainsi que tous les autres champs visibles
    return els
        .filter((el, i, arr) => arr.indexOf(el) === i) // déduplique
        .filter(el => (el.tagName === 'INPUT' && el.type === 'file') || isVisible(el))
        .map(el => {
            const role = el.getAttribute('role') || '';
            const aa = el.getAttribute('aria-autocomplete') || '';
            const isSearchbox = role === 'searchbox';
            const isAutocomplete = role === 'combobox' && aa === 'list';
            if (isSearchbox || isAutocomplete) {
                const lbl = (getLabel(el) || '').toLowerCase();
                const ph  = (el.placeholder || '').toLowerCase();
                // Filtre UNIQUEMENT les vrais champs de recherche — pas les React Select de formulaire
                // Ne filtre PAS sur !lbl car React Select peut avoir label via aria-labelledby dynamique
                const isSearch = lbl.includes('search') || lbl.includes('rechercher')
                    || ph.includes('search') || ph.includes('rechercher')
                    || ph.includes('chercher');
                // Un champ vide de label n'est un search que si son placeholder le dit
                if (isSearch) return null;
                // Si vraiment aucun label ET aucun placeholder utile → on garde quand même (combobox de form)
            }
            let lbl = getLabel(el);
            // Pour radios/checkboxes : préfixe avec le label du groupe (la question)
            if (el.type === 'radio' || el.type === 'checkbox') {
                const grp = getGroupLabel(el);
                if (grp && grp !== lbl) {
                    lbl = lbl ? grp + ' → ' + lbl : grp;
                }
            }
            const isRadioOrCheck = el.tagName === 'INPUT' && (el.type === 'radio' || el.type === 'checkbox');
            const isRichText = role === 'textbox' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA';
            const isContentEditable = el.getAttribute('contenteditable') === 'true';
            const isSpinbutton = role === 'spinbutton';
            // type synthétique pour que Python sache comment remplir
            let syntheticType = el.type || '';
            if (isRichText || isContentEditable) syntheticType = 'richtext';
            if (isSpinbutton) syntheticType = 'spinbutton';
            return {
                id:          el.id || '',
                name:        el.name || el.getAttribute('data-automation-id') || '',
                tag:         el.tagName.toLowerCase(),
                type:        syntheticType,
                label:       lbl,
                placeholder: el.placeholder || el.getAttribute('aria-placeholder') || '',
                value:       isRadioOrCheck ? (el.value || '') : '',
                required:    el.required || el.getAttribute('aria-required') === 'true',
                accept:      el.accept || '',
                hidden:      !isVisible(el),
                richtext:    isRichText || isContentEditable,
                combobox:    isAutocomplete || role === 'combobox'
                             || (el.placeholder || '').toLowerCase().includes('start typing'),
                options:     el.tagName === 'SELECT'
                             ? Array.from(el.options).map(o => ({v: o.value, t: (o.text||'').trim()})).slice(0, 24)
                             : [],
            };
        })
        .filter(Boolean);
}
"""

# Indicateur de progression "Step 2 of 4"
JS_STEP_INDICATOR = """
() => {
    const txt = document.body.innerText;
    const patterns = [
        /Étape\\s+(\\d+)\\s+sur\\s+(\\d+)/i,
        /Step\\s+(\\d+)\\s+of\\s+(\\d+)/i,
        /(\\d+)\\s*\\/\\s*(\\d+)\\s*(étape|step)/i,
        /Page\\s+(\\d+)\\s+sur\\s+(\\d+)/i,
        /(\\d+)\\s+de\\s+(\\d+)/i,
    ];
    for (const re of patterns) {
        const m = txt.match(re);
        if (m) return m[1] + '/' + m[2];
    }
    return '';
}
"""


# ── Utilitaires Playwright (legacy fill()) ────────────────────────────────────

def _try_fill(page, field_key: str, value: str) -> bool:
    if not value or not str(value).strip():
        return False
    for sel in FIELD_SELECTORS.get(field_key, []):
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.click(timeout=800)
                time.sleep(0.15)
                loc.fill(value)
                time.sleep(0.1)
                console.print(f"  [dim]  ✓ {field_key}[/dim]")
                return True
        except Exception:
            continue
    return False


def _try_upload(page, cv_path: Path) -> bool:
    if not cv_path or not cv_path.exists():
        return False
    for sel in FIELD_SELECTORS["cv_upload"]:
        try:
            loc = page.locator(sel).first
            if loc.count() > 0:
                loc.set_input_files(str(cv_path))
                time.sleep(0.5)
                console.print(f"  [dim]  ✓ cv_upload → {cv_path.name}[/dim]")
                return True
        except Exception:
            continue
    return False


def _fill_cover_letter(page, text: str) -> bool:
    for sel in FIELD_SELECTORS["cover_letter"]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.click(timeout=800)
                time.sleep(0.2)
                tag = loc.evaluate("el => el.tagName.toLowerCase()")
                if tag == "textarea":
                    loc.fill(text)
                else:
                    page.keyboard.press("Control+a")
                    page.keyboard.type(text, delay=2)
                console.print(f"  [dim]  ✓ cover_letter ({len(text)} chars)[/dim]")
                return True
        except Exception:
            continue
    return False


def _fill_generic(page, cv_path: Path, letter_text: str):
    filled = []
    if _try_fill(page, "first_name", CANDIDATE["first_name"]):   filled.append("prénom")
    if _try_fill(page, "last_name",  CANDIDATE["last_name"]):    filled.append("nom")
    if _try_fill(page, "email",      CANDIDATE["email"]):        filled.append("email")
    if _try_fill(page, "phone",      CANDIDATE["phone"]):        filled.append("tel")
    if _try_fill(page, "linkedin",   CANDIDATE["linkedin"]):     filled.append("linkedin")
    if _try_fill(page, "website",    CANDIDATE["website"]):      filled.append("site")
    if _try_upload(page, cv_path):                               filled.append("CV")
    if letter_text and _fill_cover_letter(page, letter_text):    filled.append("lettre")
    return filled


# ── Classe principale ─────────────────────────────────────────────────────────

class AutoFiller:

    def __init__(self, headless: bool = False, profile_dir=None, shared_pw=None):
        # shared_pw : instance playwright partagée (évite de créer plusieurs event loops)
        #   None      → crée son propre sync_playwright()
        #   objet pw  → utilise l'instance fournie (ne la détruit pas dans _close)
        self._pw_ctx      = shared_pw   # None ou pw partagé
        self._owns_pw     = shared_pw is None  # True = on a créé le pw, on doit le détruire
        self._browser  = None
        self.headless  = headless
        # profile_dir : répertoire Chromium à utiliser.
        #   None  → profil persistant par défaut (~/.job-apply-browser)
        #   Path  → répertoire isolé (mode batch : une fenêtre par offre)
        self._profile_dir = Path(profile_dir) if profile_dir else None
        self._debug_counter = 0
        self._no_spontaneous_form = False  # True si WTTJ spontané sans formulaire trouvé
        self._auto_submit_confirmed = False  # True si confirmation de soumission détectée
        self._auto_submit_message = ""       # Texte de la confirmation ou raison d'échec
        self._auto_submit_screenshot = ""    # Chemin du screenshot d'échec (si échec)
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)

    @property
    def _active_profile(self) -> Path:
        """Répertoire de profil à utiliser : isolé si défini, sinon profil principal."""
        return self._profile_dir if self._profile_dir else BROWSER_PROFILE

    def _release_profile_lock(self) -> bool:
        """
        Tue tout Chromium orphelin qui tient encore le profil actif
        et supprime les Singleton* lock files. Retourne True si quelque
        chose a été nettoyé.
        En mode profil isolé (batch), skip le kill global : seul notre process nous appartient.
        """
        import subprocess, os, signal
        profile = self._active_profile
        cleaned = False
        # 1. Tue les processus qui utilisent CE profil
        try:
            r = subprocess.run(
                ["pgrep", "-f", f"user-data-dir={profile}"],
                capture_output=True, text=True, timeout=3,
            )
            pids = [int(p) for p in r.stdout.split() if p.strip().isdigit()]
            for pid in pids:
                try:
                    os.kill(pid, signal.SIGTERM)
                    cleaned = True
                except ProcessLookupError:
                    pass
                except PermissionError:
                    pass
            if pids:
                console.print(f"  [yellow]🧹 Chromium orphelin tué (pid {pids[0]})[/yellow]")
                time.sleep(0.8)
                for pid in pids:
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    except PermissionError:
                        pass
        except FileNotFoundError:
            pass
        except Exception:
            pass

        # 2. Supprime les lock files
        for fname in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
            f = profile / fname
            try:
                if f.exists() or f.is_symlink():
                    f.unlink()
                    cleaned = True
            except Exception:
                pass
        return cleaned

    def _ensure_browser(self):
        if self._browser:
            try:
                _ = self._browser.pages
                return
            except Exception:
                console.print("  [yellow]⚠ Navigateur Chromium mort — relancement automatique...[/yellow]")
                try:
                    self._pw_ctx.__exit__(None, None, None)
                except Exception:
                    pass
                self._browser = None
                self._pw_ctx = None
        from playwright.sync_api import sync_playwright
        profile = self._active_profile
        profile.mkdir(parents=True, exist_ok=True)

        # En mode profil isolé, pas besoin de tuer les autres — juste nettoyer les locks
        self._release_profile_lock()

        # Patch Default/Preferences pour marquer la session précédente comme "Normal"
        # (évite le dialog "Chrome n'a pas été arrêté correctement")
        # Seulement pour le profil principal (les profils isolés sont toujours frais)
        prefs_path = profile / "Default" / "Preferences"
        if prefs_path.exists():
            try:
                prefs = json.loads(prefs_path.read_text(encoding="utf-8"))
                profile_prefs = prefs.setdefault("profile", {})
                profile_prefs["exit_type"] = "Normal"
                profile_prefs["exited_cleanly"] = True
                prefs_path.write_text(json.dumps(prefs), encoding="utf-8")
            except Exception:
                pass

        if self._pw_ctx is None:
            self._pw_ctx = sync_playwright().__enter__()
            self._owns_pw = True

        # Charge l'état WTTJ sauvegardé explicitement par option 14 (cookies + localStorage)
        # Toujours depuis le profil PRINCIPAL (wttj_state.json n'est pas copié dans les isolés)
        _wttj_state_path = BROWSER_PROFILE / "wttj_state.json"
        _wttj_cookies_to_inject = []
        _wttj_origins = []
        if _wttj_state_path.exists():
            try:
                _state = json.loads(_wttj_state_path.read_text(encoding="utf-8"))
                # Sanitize : enlève les fields que add_cookies pourrait rejeter
                for c in _state.get("cookies", []):
                    cc = {k: v for k, v in c.items()
                          if k in ("name", "value", "domain", "path", "expires",
                                   "httpOnly", "secure", "sameSite")}
                    if cc.get("name") and cc.get("value") and cc.get("domain"):
                        _wttj_cookies_to_inject.append(cc)
                # Garde uniquement les origins WTTJ pour l'injection localStorage
                _wttj_origins = [
                    o for o in _state.get("origins", [])
                    if "welcometothejungle" in (o.get("origin", "") or "")
                ]
            except Exception:
                pass

        def _launch():
            return self._pw_ctx.chromium.launch_persistent_context(
                user_data_dir=str(profile),
                headless=self.headless,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--no-session-restore",
                    "--disable-session-crashed-bubble",
                    "--hide-crash-restore-bubble",
                    "--no-first-run",
                    "--disable-default-apps",
                ],
                slow_mo=60,
            )

        try:
            self._browser = _launch()
        except Exception as e:
            msg = str(e)[:200]
            console.print(f"  [yellow]Lancement du navigateur a échoué : {msg}[/yellow]")
            console.print(f"  [yellow]→ Tentative de nettoyage du profil...[/yellow]")
            self._release_profile_lock()
            time.sleep(1)
            self._browser = _launch()

        # Injecte les cookies WTTJ sauvegardés (complète le profil persistant)
        if _wttj_cookies_to_inject:
            try:
                self._browser.add_cookies(_wttj_cookies_to_inject)
                console.print(f"  [dim]✓ {len(_wttj_cookies_to_inject)} cookie(s) WTTJ restauré(s)[/dim]")
            except Exception as e:
                console.print(f"  [yellow]⚠ Cookies WTTJ : {str(e)[:80]}[/yellow]")

        # Injecte le localStorage WTTJ via init script (auth tokens, etc.)
        if _wttj_origins:
            try:
                ls_items = []
                for org in _wttj_origins:
                    for item in org.get("localStorage", []) or []:
                        ls_items.append({"name": item.get("name"), "value": item.get("value")})
                if ls_items:
                    init_script = (
                        "(() => { if (location.hostname.includes('welcometothejungle')) { "
                        + "; ".join(
                            f"try{{ localStorage.setItem({json.dumps(it['name'])}, {json.dumps(it['value'])}); }}catch(e){{}}"
                            for it in ls_items if it.get("name") is not None
                        )
                        + "; }})();"
                    )
                    self._browser.add_init_script(init_script)
                    console.print(f"  [dim]✓ {len(ls_items)} entrée(s) localStorage WTTJ restaurée(s)[/dim]")
            except Exception as e:
                console.print(f"  [yellow]⚠ localStorage WTTJ : {str(e)[:80]}[/yellow]")

    def _close(self):
        try:
            if self._browser:
                self._browser.close()
        except Exception:
            pass
        self._browser = None
        # Ne détruit le playwright context que si on le possède (pas partagé)
        if self._owns_pw:
            try:
                if self._pw_ctx:
                    self._pw_ctx.__exit__(None, None, None)
            except Exception:
                pass
            self._pw_ctx = None

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _screenshot(self, page, label: str = "step") -> Optional[Path]:
        """Capture d'écran de debug. Retourne le chemin ou None."""
        try:
            self._debug_counter += 1
            ts = datetime.now().strftime("%H%M%S")
            path = DEBUG_DIR / f"{ts}_{self._debug_counter:02d}_{label}.png"
            page.screenshot(path=str(path), full_page=False, timeout=4000)
            return path
        except Exception:
            return None

    def _wait_settled(self, page, timeout_ms: int = 5000, *, fast: bool = False):
        """Attend que la page se stabilise après navigation/interaction."""
        dom_ms = min(timeout_ms, 1800 if fast else timeout_ms)
        try:
            page.wait_for_load_state("domcontentloaded", timeout=dom_ms)
        except Exception:
            pass
        if fast:
            return
        try:
            page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 2500))
        except Exception:
            pass

    def _dismiss_linkedin_save_draft_dialog(self, page) -> bool:
        """
        Ferme « Enregistrer cette candidature ? » (Easy Apply) qui bloque Suivant.
        Priorité à la croix en haut à droite, sinon Abandonner.
        """
        try:
            result = page.evaluate(JS_DISMISS_LINKEDIN_SAVE_DRAFT)
            if result:
                time.sleep(0.2)
                console.print(f"  [dim]✓ Popup LinkedIn fermée ({result})[/dim]")
                return True
        except Exception:
            pass

        for marker in ("Enregistrer cette candidature", "Save this application"):
            try:
                dlg = page.locator(f"[role='dialog']:has-text('{marker}')").last
                if dlg.count() == 0 or not dlg.is_visible(timeout=200):
                    continue
                for sel in (
                    "button.artdeco-modal__dismiss",
                    "button[data-test-modal-close-btn]",
                    "[aria-label='Dismiss']",
                    "[aria-label='Fermer']",
                    "[aria-label='Close']",
                ):
                    btn = dlg.locator(sel).first
                    if btn.count() and btn.is_visible(timeout=200):
                        btn.click(timeout=1500)
                        time.sleep(0.2)
                        console.print("  [dim]✓ Popup « Enregistrer candidature » fermée (X)[/dim]")
                        return True
                abandon = dlg.get_by_role(
                    "button", name=re.compile(r"^Abandonner$|^Discard$", re.I),
                ).first
                if abandon.count() and abandon.is_visible(timeout=200):
                    abandon.click(timeout=1500)
                    time.sleep(0.2)
                    console.print("  [dim]✓ Popup « Enregistrer candidature » fermée (Abandonner)[/dim]")
                    return True
            except Exception:
                continue
        return False

    def _dismiss_intermediate_popups(self, page) -> bool:
        """
        Ferme les popups intermédiaires non-cookies qui bloquent le flux :
        - LinkedIn « Enregistrer cette candidature ? »
        - WTTJ "Où allez-vous postuler ?" (popup tracking)
        - Confirmations de redirect, newsletters, surveys, etc.
        Retourne True si une popup a été fermée.
        """
        if self._dismiss_linkedin_save_draft_dialog(page):
            return True
        # Heuristique : cherche un dialog/modal avec un bouton "Fermer", "Close",
        # "Plus tard", "Skip", "No thanks" — qui ferme sans soumettre quoi que ce soit
        DISMISS_TEXTS = (
            "Fermer", "Close", "Plus tard", "Later", "Skip", "Passer",
            "No thanks", "Non merci", "Pas maintenant", "Not now",
            "Ignorer", "Dismiss",
        )
        try:
            for txt in DISMISS_TEXTS:
                # Boutons explicites dans des dialogs
                for sel in [
                    f"[role='dialog'] button:has-text('{txt}')",
                    f"[role='dialog'] a:has-text('{txt}')",
                    f"[aria-modal='true'] button:has-text('{txt}')",
                ]:
                    try:
                        btn = page.locator(sel).first
                        if btn.count() and btn.is_visible(timeout=200):
                            btn.click(timeout=1500)
                            time.sleep(0.4)
                            console.print(f"  [dim]✓ Popup fermée ('{txt}')[/dim]")
                            return True
                    except Exception:
                        continue
            # Aussi : bouton "X" / close en haut à droite des dialogs
            for sel in [
                "[role='dialog'] [aria-label*='close' i]",
                "[role='dialog'] [aria-label*='fermer' i]",
                "[role='dialog'] button.close",
            ]:
                try:
                    btn = page.locator(sel).first
                    if btn.count() and btn.is_visible(timeout=200):
                        btn.click(timeout=1500)
                        time.sleep(0.4)
                        console.print(f"  [dim]✓ Popup fermée (X)[/dim]")
                        return True
                except Exception:
                    continue
        except Exception:
            pass
        return False

    def _dismiss_cookies(self, page) -> bool:
        """Ferme la bannière cookies si présente. Retourne True si cliqué."""
        try:
            for sel in COOKIE_ACCEPT_SELECTORS:
                try:
                    btn = page.locator(sel).first
                    if btn.count() == 0:
                        continue
                    if not btn.is_visible(timeout=200):
                        continue
                    btn.click(timeout=1500)
                    time.sleep(0.5)
                    console.print(f"  [dim]✓ Cookies acceptés ({sel[:40]})[/dim]")
                    return True
                except Exception:
                    continue
            # Frames (parfois la bannière est dans un iframe TrustArc)
            for fr in page.frames:
                if fr == page.main_frame:
                    continue
                for sel in COOKIE_ACCEPT_SELECTORS[:8]:
                    try:
                        btn = fr.locator(sel).first
                        if btn.count() and btn.is_visible(timeout=200):
                            btn.click(timeout=1500)
                            time.sleep(0.5)
                            console.print(f"  [dim]✓ Cookies acceptés (iframe)[/dim]")
                            return True
                    except Exception:
                        continue
        except Exception:
            pass
        return False

    def _scroll_and_wait_form(self, page, max_wait_ms: int = 8000):
        """
        Scroll de haut en bas par paliers pour trigger les lazy-loads,
        puis attend que le nombre de champs de formulaire utiles se stabilise.
        S'assure que le scroll va jusqu'au bas (pas juste 600px) pour
        révéler les file inputs et les champs en fin de formulaire.
        """
        deadline = time.time() + max_wait_ms / 1000.0
        last_count = -1
        stable_iterations = 0
        try:
            page.evaluate("() => window.scrollTo(0, 0)")
        except Exception:
            pass

        scroll_pos = 0
        scroll_step = 800
        max_scroll = 0
        try:
            max_scroll = page.evaluate("() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)") or 5000
        except Exception:
            max_scroll = 5000

        while time.time() < deadline:
            try:
                count = page.evaluate("""
                    () => {
                        let n = 0;
                        document.querySelectorAll('input, textarea, select').forEach(el => {
                            const t = el.type || '';
                            if (t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset') return;
                            // Inclus les file inputs même cachés (souvent display:none derrière un bouton custom)
                            if (t === 'file') { n++; return; }
                            const role = el.getAttribute('role') || '';
                            const ph   = (el.placeholder || '').toLowerCase();
                            const lbl  = (el.getAttribute('aria-label') || '').toLowerCase();
                            if (role === 'searchbox') return;
                            if (ph.includes('search') || ph.includes('rechercher') || ph.includes('chercher')) return;
                            if (lbl.includes('search') || lbl.includes('rechercher')) return;
                            const r = el.getBoundingClientRect();
                            if (r.width === 0 || r.height === 0) return;
                            n++;
                        });
                        return n;
                    }
                """) or 0
            except Exception:
                count = last_count

            if count >= 3 and count == last_count:
                stable_iterations += 1
                if stable_iterations >= 2 and scroll_pos >= max_scroll:
                    break
            else:
                stable_iterations = 0
            last_count = count

            # Scroll progressif jusqu'au bas
            try:
                if scroll_pos < max_scroll:
                    scroll_pos += scroll_step
                    page.evaluate(f"() => window.scrollTo(0, {scroll_pos})")
                    # Re-eval max_scroll au cas où plus de contenu se charge
                    max_scroll = page.evaluate("() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)") or max_scroll
            except Exception:
                pass
            time.sleep(0.4)

        # Remet en haut pour que le 1er champ soit dans la viewport
        try:
            page.evaluate("() => window.scrollTo(0, 0)")
        except Exception:
            pass
        return last_count >= 1

    def _switch_to_latest_page(self, current_page, pages_before=None):
        """Si un nouvel onglet a été ouvert, retourne ce nouvel onglet.

        pages_before : snapshot des id() de pages existantes AVANT le clic qui a
        pu ouvrir un popup. Quand fourni, on ne cherche QUE parmi les pages
        nouvellement créées — évite de se tromper d'onglet quand d'autres
        formulaires déjà remplis sont encore ouverts.
        """
        try:
            pages = [p for p in self._browser.pages if not p.is_closed()]
            if len(pages) <= 1:
                return current_page

            if pages_before is not None:
                # Cherche uniquement parmi les pages qui n'existaient pas avant le clic
                new_pages = [
                    p for p in pages
                    if id(p) not in pages_before and p is not current_page
                ]
                # Préfère un onglet ATS externe (pas LinkedIn / about:blank)
                for p in reversed(new_pages):
                    try:
                        u = p.url or ""
                        if u and u != "about:blank" and "linkedin.com" not in u:
                            p.bring_to_front()
                            try:
                                p.wait_for_load_state("domcontentloaded", timeout=8000)
                            except Exception:
                                pass
                            return p
                    except Exception:
                        continue
                for p in reversed(new_pages):
                    try:
                        p.bring_to_front()
                    except Exception:
                        pass
                    try:
                        p.wait_for_load_state("domcontentloaded", timeout=8000)
                    except Exception:
                        pass
                    return p
                return current_page

            # Fallback sans snapshot : prend le plus récent qui n'est pas current
            for p in reversed(pages):
                if p is current_page:
                    continue
                if p.url and p.url != "about:blank":
                    try:
                        p.bring_to_front()
                    except Exception:
                        pass
                    try:
                        p.wait_for_load_state("domcontentloaded", timeout=8000)
                    except Exception:
                        pass
                    return p
            return current_page
        except Exception:
            return current_page

    def _new_page_handler(self, popup):
        """Gestionnaire pour les pop-ups (LinkedIn redirect → ATS externe)."""
        try:
            popup.wait_for_load_state("domcontentloaded", timeout=10_000)
        except Exception:
            pass
        return popup

    class _PageClickTracker:
        """Suit les nouveaux onglets ouverts pendant un clic (target=_blank, window.open)."""

        def __init__(self, context):
            self._context = context
            self.new_pages: List = []
            self._handler = None

        def __enter__(self):
            def _on_page(p):
                self.new_pages.append(p)
                try:
                    p.wait_for_load_state("domcontentloaded", timeout=10_000)
                except Exception:
                    pass

            self._handler = _on_page
            try:
                self._context.on("page", self._handler)
            except Exception:
                pass
            return self

        def __exit__(self, *_args):
            try:
                if self._handler:
                    self._context.remove_listener("page", self._handler)
            except Exception:
                pass

        def best_url(self, current_url: str = "") -> str:
            for p in reversed(self.new_pages):
                try:
                    u = p.url or ""
                    if u and u != "about:blank" and "linkedin.com" not in u:
                        return u
                except Exception:
                    continue
            for p in reversed(self.new_pages):
                try:
                    u = p.url or ""
                    if u and u not in ("about:blank", "") and u != current_url:
                        return u
                except Exception:
                    continue
            return ""

        def best_page(self, current_page, pages_before=None):
            for p in reversed(self.new_pages):
                try:
                    if p.is_closed():
                        continue
                    u = p.url or ""
                    if pages_before is not None and id(p) in pages_before:
                        continue
                    if u and u != "about:blank" and "linkedin.com" not in u:
                        return p
                except Exception:
                    continue
            for p in reversed(self.new_pages):
                try:
                    if not p.is_closed():
                        return p
                except Exception:
                    continue
            return None

    def _resolve_url_after_click(
        self, page, url_before: str, popup_url: List[str],
        page_tracker=None, pages_before=None,
    ) -> str:
        """URL effective après clic : popup, nouvel onglet, navigation ou modale."""
        if popup_url and popup_url[0]:
            return popup_url[0]
        if page_tracker:
            tracked = page_tracker.best_page(page, pages_before)
            if tracked is not None:
                try:
                    return tracked.url or url_before
                except Exception:
                    pass
            turl = page_tracker.best_url(url_before)
            if turl:
                return turl
        if page.url != url_before:
            return page.url
        try:
            if page.locator('[role="dialog"]').first.is_visible(timeout=600):
                return page.url
        except Exception:
            pass
        return page.url

    def _count_usable_fields(self, fields: List[dict]) -> int:
        usable = [
            f for f in fields
            if not _is_junk_field(f)
            and (f.get("id") or f.get("name") or (f.get("label") or "").strip())
        ]
        return len(usable)

    def _probe_form_fields(self, page, scope) -> Tuple[Any, List[dict], Any, int]:
        """
        Cherche les champs utiles dans scope puis dans toutes les iframes.
        Retourne (fill_scope, fields, used_frame, usable_count).
        """
        fields = self._extract_fields(scope)
        fill_scope = scope
        used_frame = None
        count = self._count_usable_fields(fields)
        best_count = count
        best_fields = fields
        best_scope = fill_scope
        best_frame = None

        for fr in self._get_form_frames(page):
            if fr == page.main_frame:
                continue
            ff = self._extract_fields(fr)
            ff_count = self._count_usable_fields(ff)
            if ff_count > best_count:
                best_count = ff_count
                best_fields = ff
                best_scope = fr
                best_frame = fr

        return best_scope, best_fields, best_frame, best_count

    def _ensure_ashby_application_tab(self, page) -> bool:
        """Ashby (Alan, etc.) : l'onglet Application doit être actif pour voir les champs."""
        for tab_sel in (
            "[role='tab']:has-text('Application')",
            "[role='tab']:has-text('Apply')",
            "a:has-text('Application')",
            "button:has-text('Application')",
            "[data-testid*='application' i]",
        ):
            try:
                tab = page.locator(tab_sel).first
                if tab.count() == 0 or not tab.is_visible(timeout=400):
                    continue
                selected = (tab.get_attribute("aria-selected") or "").lower() == "true"
                if selected:
                    return False
                tab.click(timeout=2000)
                time.sleep(0.7)
                console.print("  [dim]→ Ashby : onglet Application activé[/dim]")
                return True
            except Exception:
                continue
        return False

    def _ensure_application_form_ready(self, page, ats: str, max_rounds: int = 4):
        """
        Prépare la page formulaire : cookies, popups, clic Apply si nécessaire.
        Retourne (page, ats).
        """
        for round_i in range(max_rounds):
            self._dismiss_cookies(page)
            self._dismiss_intermediate_popups(page)
            self._scroll_and_wait_form(page, max_wait_ms=4500)

            scope, scope_label = self._get_form_scope(page)
            if scope_label == "dialog":
                return page, ats

            _, _, _, n = self._probe_form_fields(page, scope)
            if n >= 2:
                return page, ats
            if self._is_on_submit_page(scope) or self._is_on_submit_page(page):
                return page, ats
            if ats in ATS_INLINE_FORM and n >= 1:
                return page, ats

            if round_i >= max_rounds - 1:
                break

            # Ashby (et ATS similaires avec onglets) : l'onglet "Application" doit
            # être cliqué avant que les champs soient visibles.
            if n == 0:
                tab_clicked = False
                for tab_sel in (
                    "[role='tab']:has-text('Application')",
                    "[role='tab']:has-text('Postuler')",
                    "[role='tab']:has-text('Candidater')",
                    "nav a:has-text('Application')",
                    "a:has-text('Apply')",
                    "button:has-text('Apply')",
                ):
                    try:
                        tab = page.locator(tab_sel).first
                        if tab.count() and tab.is_visible(timeout=400):
                            tab.click(timeout=2000)
                            time.sleep(0.6)
                            console.print(f"  [dim]→ Onglet application cliqué ({tab_sel})[/dim]")
                            tab_clicked = True
                            break
                    except Exception:
                        continue
                if tab_clicked:
                    continue

            console.print(
                f"  [yellow]→ Formulaire peu visible ({n} champ(s)) — "
                f"tentative Apply {round_i + 1}/{max_rounds - 1}[/yellow]"
            )
            _pb = {id(p) for p in self._browser.pages if not p.is_closed()}
            click_ats = ats if ats != "unknown" else "unknown"
            clicked, _ = self._click_apply_button(page, click_ats)
            if not clicked and ats != "unknown":
                clicked, _ = self._click_apply_button(page, "unknown")
            if clicked:
                page = self._switch_to_latest_page(page, pages_before=_pb)
                self._wait_settled(page, 4000)
                self._dismiss_cookies(page)
                new_ats = detect_ats_page(page)
                if new_ats != "unknown":
                    ats = new_ats
            else:
                try:
                    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    time.sleep(0.6)
                except Exception:
                    pass

        return page, ats

    def _enter_from_linkedin_job(self, page, job_url: str, cv_path) -> Tuple[Any, str]:
        """
        LinkedIn → Easy Apply (modale) ou ATS externe (nouvel onglet / redirect).
        Retourne (page, ats).
        """
        if not self._ensure_linkedin_logged_in(page):
            return None, "linkedin"

        if "/jobs/view/" not in page.url and job_url not in page.url:
            page.goto(job_url, wait_until="domcontentloaded", timeout=20_000)
            self._wait_settled(page, 4000)
            self._dismiss_cookies(page)

        linkedin_tab = page
        pref = self._linkedin_apply_preference(page)
        console.print(f"  [dim]LinkedIn mode : {pref}[/dim]")

        _pb_li = {id(p) for p in self._browser.pages if not p.is_closed()}
        clicked, _ = self._click_apply_button(page, "linkedin")
        if not clicked:
            console.print("  [yellow]⚠ Bouton Postuler introuvable.[/yellow]")
            self._screenshot(page, "no_apply_button")
            return page, "linkedin"

        page = self._poll_after_linkedin_apply_click(
            page, _pb_li, cv_path=cv_path, max_wait_s=15,
        )

        if "linkedin.com" not in page.url and linkedin_tab is not page:
            try:
                if not linkedin_tab.is_closed():
                    linkedin_tab.close()
                    console.print("  [dim]🗙 onglet LinkedIn fermé[/dim]")
            except Exception:
                pass

        if "linkedin.com" not in page.url:
            ats = detect_ats_page(page)
            console.print(f"  [cyan]→ Sur ATS externe : {ats} ({page.url[:60]})[/cyan]")
            if ats not in ATS_INLINE_FORM:
                _pb_ats = {id(p) for p in self._browser.pages if not p.is_closed()}
                clicked2, _ = self._click_apply_button(page, ats)
                if clicked2:
                    console.print(f"  [green]✓ Bouton Postuler de {ats} cliqué[/green]")
                    page = self._switch_to_latest_page(page, pages_before=_pb_ats)
                    self._wait_settled(page, 4000)
                    self._dismiss_cookies(page)
                    self._dismiss_intermediate_popups(page)
            page, ats = self._ensure_application_form_ready(page, ats)
            return page, ats

        return page, "linkedin"

    def _get_form_scope(self, page) -> Tuple[Any, str]:
        """
        Retourne (scope, label) où scope est :
          - une Locator si une dialog modale est présente (LinkedIn Easy Apply)
          - le main frame de la page sinon
        Et label décrit le scope.
        """
        try:
            dialog = page.locator('[role="dialog"]').first
            if dialog.count() > 0 and dialog.is_visible(timeout=400):
                return dialog, "dialog"
        except Exception:
            pass
        return page, "page"

    def _get_form_frames(self, page) -> List:
        """
        Retourne les frames qui contiennent des champs de formulaire.
        La main frame en premier, puis les iframes (Greenhouse, etc.).
        """
        frames = [page.main_frame]
        for fr in page.frames:
            if fr == page.main_frame:
                continue
            try:
                # Test rapide : présence d'un input/textarea/select
                count = fr.evaluate("""() => document.querySelectorAll('input, textarea, select').length""")
                if count and count > 0:
                    frames.append(fr)
            except Exception:
                continue
        return frames

    def _extract_fields(self, scope) -> List[Dict]:
        """
        Extrait les champs depuis une scope = page, frame, ou Locator.
        - Locator (ex: dialog modale) : evaluate auto-passe l'élément
        - Page ou Frame : on passe None pour que le JS utilise document
        """
        try:
            if hasattr(scope, "element_handle"):
                # Locator
                return scope.evaluate(JS_EXTRACT_FIELDS) or []
            # Page ou Frame
            return scope.evaluate(JS_EXTRACT_FIELDS, None) or []
        except Exception as e:
            console.print(f"  [yellow]Extraction champs échouée : {str(e)[:100]}[/yellow]")
            return []

    def _get_step_indicator(self, page) -> str:
        try:
            return page.evaluate(JS_STEP_INDICATOR) or ""
        except Exception:
            return ""

    def _is_on_submit_page(self, scope_or_page) -> bool:
        for sel in SUBMIT_SELECTORS:
            try:
                loc = scope_or_page.locator(sel).first
                if loc.count() > 0 and loc.is_visible(timeout=300):
                    return True
            except Exception:
                continue
        try:
            btn = scope_or_page.get_by_role("button", name=SUBMIT_BUTTON_NAME_RE).first
            if btn.count() > 0 and btn.is_visible(timeout=300):
                txt = (btn.text_content() or btn.get_attribute("aria-label") or "").strip()
                if txt and not any(x in txt.lower() for x in ("suivant", "next", "continuer", "continue")):
                    return True
        except Exception:
            pass
        return False

    def _submit_stop_message(self, scope_or_page) -> str:
        """Libellé du bouton submit visible (pour les logs)."""
        for sel in SUBMIT_SELECTORS:
            try:
                loc = scope_or_page.locator(sel).first
                if loc.count() > 0 and loc.is_visible(timeout=200):
                    return (loc.text_content() or loc.get_attribute("aria-label") or "Submit").strip()[:50]
            except Exception:
                continue
        return "Envoyer la candidature"

    def _click_review_button(self, scope_or_page) -> bool:
        """LinkedIn a parfois un bouton 'Vérifier' avant le Submit final."""
        for sel in REVIEW_SELECTORS:
            try:
                btn = scope_or_page.locator(sel).first
                if btn.count() > 0 and btn.is_visible(timeout=300):
                    btn.click(timeout=2000)
                    time.sleep(1.5)
                    return True
            except Exception:
                continue
        return False

    def _click_next_button(self, scope_or_page, page=None) -> bool:
        """Clique sur Suivant/Next. Attend la stabilisation après le clic."""
        if page is not None:
            # Ferme tout dropdown d'autocomplétion avant de chercher le bouton,
            # sinon le dropdown peut masquer / intercepter le clic sur Suivant.
            self._close_typeahead_dropdown(page)
            self._dismiss_linkedin_save_draft_dialog(page)
        for sel in NEXT_SELECTORS:
            try:
                btn = scope_or_page.locator(sel).first
                if btn.count() == 0:
                    continue
                if not btn.is_visible(timeout=250):
                    continue
                txt = (btn.text_content() or "").lower()
                if any(s in txt for s in ["soumettre", "submit", "envoyer", "send"]):
                    continue
                aria = (btn.get_attribute("aria-label") or "").lower()
                if any(s in aria for s in ["soumettre", "submit", "envoyer", "send"]):
                    continue
                btn.click(timeout=3000)
                if page is not None:
                    time.sleep(0.35)
                    # La popup "Enregistrer cette candidature ?" peut apparaître
                    # juste après le clic sur Suivant — la fermer immédiatement.
                    self._dismiss_linkedin_save_draft_dialog(page)
                    self._wait_settled(page, timeout_ms=1500, fast=True)
                    self._dismiss_linkedin_save_draft_dialog(page)
                else:
                    time.sleep(0.6)
                return True
            except Exception:
                if page is not None:
                    self._dismiss_linkedin_save_draft_dialog(page)
                continue
        return False

    def _fill_linkedin_country_code(self, scope, page) -> bool:
        """Sélectionne France (+33) dans le sélecteur d'indicatif LinkedIn."""
        for sel in (
            "select[id*='country' i]",
            "select[name*='country' i]",
            "select[aria-label*='indicatif' i]",
            "select[aria-label*='country' i]",
            "select[id*='phoneNumber' i]",
        ):
            try:
                loc = scope.locator(sel).first
                if loc.count() == 0 or not loc.is_visible(timeout=400):
                    continue
                for pick in (
                    {"label": re.compile(r"France\s*\(\+33\)", re.I)},
                    {"label": re.compile(r"France", re.I)},
                    {"label": re.compile(r"\+33", re.I)},
                    {"value": "FR"},
                    {"value": "fr"},
                    {"index": 1},
                ):
                    try:
                        loc.select_option(**pick, timeout=2000)
                        console.print("  [dim]  ✓ LinkedIn indicatif France (+33)[/dim]")
                        return True
                    except Exception:
                        continue
            except Exception:
                continue

        for sel in (
            "button[aria-label*='Indicatif' i]",
            "button[aria-label*='Country code' i]",
            "[role='combobox'][aria-label*='indicatif' i]",
            "[role='combobox'][aria-label*='country' i]",
        ):
            try:
                btn = scope.locator(sel).first
                if btn.count() == 0 or not btn.is_visible(timeout=400):
                    continue
                btn.click(timeout=2000)
                time.sleep(0.5)
                for opt_sel in (
                    "[role='option']:has-text('France (+33)')",
                    "[role='option']:has-text('France')",
                    "[role='option']:has-text('+33')",
                    "li:has-text('France (+33)')",
                    "li:has-text('France')",
                ):
                    opt = page.locator(opt_sel).first
                    if opt.count() > 0 and opt.is_visible(timeout=800):
                        opt.click(timeout=2000)
                        console.print("  [dim]  ✓ LinkedIn indicatif France (+33)[/dim]")
                        return True
            except Exception:
                continue
        return False

    def _fill_linkedin_contact_fields(self, scope, page) -> bool:
        """Remplit email + indicatif + téléphone dans la modale Easy Apply."""
        filled = False

        for sel in (
            "input[type='email']",
            "input[id*='email' i]",
            "input[name*='email' i]",
            "input[autocomplete='email']",
        ):
            try:
                loc = scope.locator(sel).first
                if loc.count() == 0 or not loc.is_visible(timeout=600):
                    continue
                email = (CANDIDATE.get("email") or "").strip()
                if not email:
                    break
                cur = (loc.input_value() or "").strip()
                if not cur or cur != email:
                    loc.click(timeout=1500)
                    loc.fill(email)
                    loc.evaluate(JS_DISPATCH_REACT_EVENTS)
                    console.print(f"  [dim]  ✓ LinkedIn email → {email}[/dim]")
                    filled = True
                break
            except Exception:
                continue

        self._fill_linkedin_country_code(scope, page)

        local = CANDIDATE.get("phone_local") or CANDIDATE.get("phone_national", "").lstrip("0")
        if not local:
            return filled
        for sel in (
            "input[type='tel']",
            "input[id*='phone' i]",
            "input[name*='phone' i]",
            "input[autocomplete='tel-national']",
            "input[autocomplete='tel']",
            "input[aria-label*='téléphone' i]",
            "input[aria-label*='phone' i]",
        ):
            try:
                loc = scope.locator(sel).first
                if loc.count() == 0 or not loc.is_visible(timeout=600):
                    continue
                cur = re.sub(r"\D", "", loc.input_value() or "")
                want = re.sub(r"\D", "", local)
                if not cur or cur != want:
                    loc.click(timeout=1500)
                    loc.fill(local)
                    loc.evaluate(JS_DISPATCH_REACT_EVENTS)
                    console.print(f"  [dim]  ✓ LinkedIn téléphone → {local}[/dim]")
                    filled = True
                break
            except Exception:
                continue

        return filled

    def _linkedin_collect_typeahead_options(self, scope, page):
        """Options visibles du typeahead LinkedIn (plusieurs structures DOM)."""
        roots = [scope]
        try:
            dlg = page.locator('[role="dialog"]').first
            if dlg.count() > 0:
                roots.append(dlg)
        except Exception:
            pass

        selectors = (
            '[role="listbox"] [role="option"]',
            '[role="option"]',
            ".basic-typeahead__selectable",
            ".search-typeahead-v2__hit",
            "li.basic-typeahead__selectable",
            "[data-test-typeahead-option]",
            ".jobs-typeahead-v2__hit",
            ".basic-typeahead__triggered-content li",
        )
        seen: set[str] = set()
        out = []
        for root in roots:
            for sel in selectors:
                try:
                    for loc in root.locator(sel).all()[:20]:
                        try:
                            if not loc.is_visible(timeout=150):
                                continue
                        except Exception:
                            continue
                        t = (loc.text_content() or "").strip()
                        if not t or t in seen:
                            continue
                        seen.add(t)
                        out.append(loc)
                except Exception:
                    continue
        return out

    def _linkedin_best_typeahead_option(self, options, match_hints: List[str], query: str):
        if not options:
            return None
        ql = query.lower()
        hints = [h.lower() for h in match_hints if h]
        best = None
        best_score = -1
        for opt in options[:25]:
            t = (opt.text_content() or "").strip().lower()
            if not t:
                continue
            score = 0
            if ql and ql in t:
                score += 5
            if "france" in t:
                score += 3
            for h in hints:
                if h in t:
                    score += 2
            if ql and t.startswith(ql[: min(4, len(ql))]):
                score += 1
            if score > best_score:
                best_score = score
                best = opt
        return best or options[0]

    def _close_typeahead_dropdown(self, page) -> None:
        """Ferme le dropdown d'autocomplétion VILLE uniquement.

        On cible exclusivement les suggestions de typeahead LinkedIn (ville),
        et jamais les selects ou la dialog elle-même pour éviter de la fermer.
        """
        # Sélecteurs spécifiques aux suggestions de typeahead (pas aux selects)
        TYPEAHEAD_SELECTORS = (
            ".basic-typeahead__triggered-content",
            ".artdeco-typeahead__results-list",
            "[data-test-typeahead-list]",
        )
        try:
            for sel in TYPEAHEAD_SELECTORS:
                try:
                    el = page.locator(sel)
                    if el.count() > 0 and el.first.is_visible(timeout=200):
                        page.keyboard.press("Escape")
                        time.sleep(0.25)
                        break
                except Exception:
                    continue
        except Exception:
            pass
        time.sleep(0.1)

    def _linkedin_typeahead_select(
        self, scope, page, input_loc, query: str, match_hints: List[str]
    ) -> bool:
        """Remplit un typeahead LinkedIn (ville) et sélectionne une suggestion."""
        try:
            try:
                input_loc.scroll_into_view_if_needed(timeout=1500)
            except Exception:
                pass
            input_loc.click(timeout=2000)
            time.sleep(0.2)
            try:
                input_loc.fill("", timeout=1000)
            except Exception:
                page.keyboard.press("Control+a")
                page.keyboard.press("Backspace")
            time.sleep(0.12)
            input_loc.press_sequentially(query, delay=45)
            time.sleep(0.85)

            options = self._linkedin_collect_typeahead_options(scope, page)
            if not options and len(query) > 4:
                try:
                    input_loc.fill("")
                except Exception:
                    pass
                input_loc.press_sequentially(query[:4], delay=45)
                time.sleep(0.65)
                options = self._linkedin_collect_typeahead_options(scope, page)

            target = self._linkedin_best_typeahead_option(options, match_hints, query)
            if target:
                target.click(timeout=2500)
                time.sleep(0.35)
            elif options:
                # Pas de meilleur choix mais des options → prendre la première
                options[0].click(timeout=2500)
                time.sleep(0.35)
            else:
                page.keyboard.press("ArrowDown")
                time.sleep(0.2)
                page.keyboard.press("Enter")
                time.sleep(0.35)

            # ── Fermer le dropdown résiduel pour libérer le bouton Suivant ──
            self._close_typeahead_dropdown(page)

            val = ""
            try:
                val = (input_loc.input_value(timeout=1200) or "").strip()
            except Exception:
                val = (input_loc.evaluate("el => el.value || ''") or "").strip()
            if val and len(val) > 1:
                console.print(f"  [dim]  ✓ LinkedIn ville → {val[:55]}[/dim]")
                return True

            # Dernier recours : Escape pour fermer le dropdown
            page.keyboard.press("Escape")
            time.sleep(0.2)
        except Exception as e:
            console.print(f"  [yellow]  ⚠ LinkedIn typeahead : {str(e)[:70]}[/yellow]")
        return False

    def _fill_linkedin_city_fields(self, scope, page) -> bool:
        """Remplit le(s) champ(s) ville dans la modale Easy Apply si vides."""
        query, hints = _linkedin_city_typeahead_query()
        if not query:
            return False
        filled = False

        # Select natif (certaines étapes LinkedIn utilisent <select> pour la ville)
        city_targets = [
            (CANDIDATE.get("city") or "").strip(),
            (CANDIDATE.get("location") or "").split(",")[0].split("(")[0].strip(),
            "Paris",
            "France",
        ]
        city_targets = [t for t in city_targets if t]
        for sel in (
            "select[id*='city' i]",
            "select[name*='city' i]",
            "select[aria-label*='city' i]",
            "select[aria-label*='ville' i]",
            "select[id*='location' i]",
            "select[name*='location' i]",
        ):
            try:
                loc = scope.locator(sel).first
                if loc.count() == 0 or not loc.is_visible(timeout=400):
                    continue
                try:
                    cur = loc.input_value(timeout=400)
                except Exception:
                    cur = ""
                if cur and cur.lower() not in ("", "select", "choose", "sélectionnez"):
                    continue
                opts_raw = loc.evaluate(
                    """el => Array.from(el.options).map(o => ({v: o.value, t: (o.text||'').trim()}))"""
                ) or []
                picked = _match_select_option_text(opts_raw, city_targets)
                if picked:
                    loc.select_option(label=picked, timeout=2000)
                else:
                    for pick in city_targets:
                        try:
                            loc.select_option(label=pick, timeout=1500)
                            picked = pick
                            break
                        except Exception:
                            try:
                                loc.select_option(value=pick, timeout=1500)
                                picked = pick
                                break
                            except Exception:
                                continue
                if picked:
                    loc.evaluate(JS_DISPATCH_REACT_EVENTS)
                    console.print(f"  [dim]  ✓ LinkedIn ville (select) → {picked[:55]}[/dim]")
                    filled = True
            except Exception:
                continue

        selectors = (
            "input[aria-label*='ville' i]",
            "input[aria-label*='city' i]",
            "input[placeholder*='ville' i]",
            "input[placeholder*='city' i]",
            "input[id*='city' i]",
            "input[name*='city' i]",
            "input[id*='location' i]",
            "input[role='combobox']",
        )
        seen_ids: set[str] = set()
        for sel in selectors:
            try:
                for loc in scope.locator(sel).all()[:6]:
                    try:
                        if not loc.is_visible(timeout=250):
                            continue
                    except Exception:
                        continue
                    fid = loc.evaluate(
                        "el => el.id || el.name || el.getAttribute('aria-label') || ''"
                    ) or sel
                    if fid in seen_ids:
                        continue
                    seen_ids.add(fid)
                    aria = (loc.get_attribute("aria-label") or "").lower()
                    ph = (loc.get_attribute("placeholder") or "").lower()
                    if sel.endswith("combobox']") and not _is_city_like_field(aria, ph):
                        continue
                    if any(x in aria or x in ph for x in ("country", "pays", "indicatif", "phone", "email")):
                        continue
                    try:
                        val = (loc.input_value(timeout=400) or "").strip()
                    except Exception:
                        val = ""
                    if val and len(val) > 2:
                        continue
                    if self._linkedin_typeahead_select(scope, page, loc, query, hints):
                        filled = True
            except Exception:
                continue
        return filled

    def _linkedin_has_blocking_empty_fields(self, scope) -> bool:
        """True si email/tél/ville visibles sont encore vides (ne pas cliquer Suivant)."""
        try:
            for sel in (
                "input[type='email']",
                "input[id*='email' i]",
                "input[name*='email' i]",
            ):
                loc = scope.locator(sel).first
                if loc.count() and loc.is_visible(timeout=300):
                    if not (loc.input_value(timeout=400) or "").strip():
                        return True
                    break
            for sel in (
                "input[aria-label*='ville' i]",
                "input[aria-label*='city' i]",
                "input[placeholder*='ville' i]",
                "input[placeholder*='city' i]",
                "input[id*='city' i]",
                "select[id*='city' i]",
                "select[name*='city' i]",
            ):
                loc = scope.locator(sel).first
                if loc.count() and loc.is_visible(timeout=300):
                    tag = loc.evaluate("el => el.tagName.toLowerCase()")
                    if tag == "select":
                        cur = loc.evaluate(
                            "el => el.selectedIndex >= 0 ? (el.options[el.selectedIndex].text || '') : ''"
                        ) or ""
                    else:
                        cur = (loc.input_value(timeout=400) or "").strip()
                    if not cur or cur.lower() in (
                        "select", "choose", "sélectionnez", "type here...", "type here",
                    ):
                        return True
        except Exception:
            pass
        return False

    def _linkedin_dialog_step_text(self, scope) -> str:
        try:
            return (scope.inner_text(timeout=1500) or "").lower()
        except Exception:
            return ""

    def _linkedin_is_contact_step(self, scope) -> bool:
        txt = self._linkedin_dialog_step_text(scope)
        if not txt:
            return False
        has_phone = any(k in txt for k in ("téléphone", "telephone", "phone", "mobile"))
        has_email = "e-mail" in txt or "email" in txt or "courriel" in txt
        return has_phone or (has_email and "cv" not in txt and "resume" not in txt)

    def _linkedin_is_resume_step(self, scope) -> bool:
        if self._linkedin_has_visible_cv_upload(scope):
            return True
        try:
            if scope.locator("input[name='file']").count() > 0:
                return True
        except Exception:
            pass
        txt = self._linkedin_dialog_step_text(scope)
        if not txt:
            return False
        return any(k in txt for k in (
            "importer le cv", "importer un cv", "téléverser", "upload resume",
            "cv", "resume", "curriculum", "pièce jointe", "document",
        ))

    def _linkedin_has_visible_contact_inputs(self, scope) -> bool:
        try:
            loc = scope.locator(
                "input[type='email'], input[type='tel'], input[name*='phone' i], input[id*='phone' i]"
            ).first
            return loc.count() > 0 and loc.is_visible(timeout=500)
        except Exception:
            return False

    def _linkedin_has_visible_cv_upload(self, scope) -> bool:
        try:
            if scope.locator("input[type='file'], input[name='file']").first.count() > 0:
                return True
            if scope.locator(
                "input[type='radio'][id*='resume' i], "
                "input[type='radio'][name*='resume' i], "
                ".jobs-document-upload-redesign-card, "
                ".ui-attachment--pdf"
            ).first.count() > 0:
                return True
            for sel in LINKEDIN_CV_UPLOAD_TRIGGERS:
                loc = scope.locator(sel).first
                if loc.count() > 0 and loc.is_visible(timeout=400):
                    return True
        except Exception:
            pass
        return False

    def _linkedin_wait_cv_upload(self, scope, cv_path: Path) -> bool:
        """Attend que LinkedIn affiche le CV uploadé (ou fin du spinner)."""
        stem = cv_path.stem.lower()
        name = cv_path.name.lower()
        for _ in range(8):
            time.sleep(0.35)
            try:
                txt = (scope.inner_text(timeout=800) or "").lower()
                if stem in txt or name in txt:
                    console.print(f"  [dim]  ✓ CV LinkedIn sélectionné → {cv_path.name}[/dim]")
                    return True
            except Exception:
                pass
        console.print(f"  [dim]  ✓ CV LinkedIn envoyé → {cv_path.name}[/dim]")
        return True

    def _linkedin_click_importer_cv_button(self, scope, page) -> bool:
        """Clic sur « Importer le CV » (bouton artdeco LinkedIn, texte parfois nested)."""
        roots = []
        for candidate in (scope, page.locator('[role="dialog"]').first, page):
            try:
                if candidate.count() == 0:
                    continue
            except Exception:
                pass
            roots.append(candidate)

        for root in roots:
            try:
                clicked = root.evaluate(JS_LINKEDIN_CLICK_CV_IMPORT)
                if clicked:
                    console.print(f"  [dim]  → clic « {clicked} »[/dim]")
                    return True
            except Exception:
                continue

        import_patterns = (
            re.compile(r"Importer le CV", re.I),
            re.compile(r"Importer un CV", re.I),
            re.compile(r"Upload resume", re.I),
            re.compile(r"Télécharger un CV", re.I),
        )
        for root in roots:
            for pat in import_patterns:
                try:
                    btn = root.get_by_role("button", name=pat).first
                    if btn.count() == 0 or not btn.is_visible(timeout=400):
                        continue
                    btn.scroll_into_view_if_needed(timeout=1500)
                    btn.click(timeout=2500)
                    console.print(f"  [dim]  → clic bouton CV ({pat.pattern})[/dim]")
                    return True
                except Exception:
                    continue

        for root in roots:
            try:
                btn = root.locator("button.artdeco-button--secondary").filter(
                    has_text=re.compile(r"Importer.*CV", re.I)
                ).first
                if btn.count() > 0 and btn.is_visible(timeout=400):
                    btn.click(timeout=2500)
                    console.print("  [dim]  → clic artdeco Importer le CV[/dim]")
                    return True
            except Exception:
                pass
            try:
                btn = root.locator("button.artdeco-button").filter(
                    has_text=re.compile(r"Importer.*CV", re.I)
                ).first
                if btn.count() > 0 and btn.is_visible(timeout=400):
                    btn.click(timeout=2500)
                    console.print("  [dim]  → clic artdeco Importer le CV[/dim]")
                    return True
            except Exception:
                pass
        return False

    def _linkedin_upload_via_import_button(self, scope, page, cv_path: Path) -> bool:
        """Ouvre le file chooser via le bouton « Importer le CV » puis envoie le PDF."""
        try:
            with page.expect_file_chooser(timeout=7000) as fc_info:
                if not self._linkedin_click_importer_cv_button(scope, page):
                    return False
            fc_info.value.set_files(str(cv_path))
            time.sleep(0.5)
            console.print(f"  [dim]  ✓ CV LinkedIn (Importer le CV) → {cv_path.name}[/dim]")
            return True
        except Exception:
            pass

        if self._linkedin_click_importer_cv_button(scope, page):
            time.sleep(0.35)
            for root in (scope, page.locator('[role="dialog"]').first, page):
                try:
                    fi = root.locator("input[name='file'], input[type='file']").first
                    if fi.count() > 0:
                        fi.set_input_files(str(cv_path), timeout=5000)
                        console.print(f"  [dim]  ✓ CV LinkedIn (post-clic input) → {cv_path.name}[/dim]")
                        return True
                except Exception:
                    continue
        return False

    def _linkedin_upload_generated_cv(self, scope, page, cv_path: Path) -> bool:
        """
        Upload le CV généré dans Easy Apply même si LinkedIn affiche déjà
        plusieurs CV préchargés (input[name=file] souvent caché).
        """
        if not cv_path or not cv_path.exists():
            return False
        cv_path = cv_path.resolve()

        if self._linkedin_upload_via_import_button(scope, page, cv_path):
            return self._linkedin_wait_cv_upload(scope, cv_path)

        if self._upload_cv_via_chooser(page, cv_path, scope=scope):
            return self._linkedin_wait_cv_upload(scope, cv_path)

        for sel in LINKEDIN_CV_UPLOAD_TRIGGERS:
            try:
                trigger = scope.locator(sel).first
                if trigger.count() == 0 or not trigger.is_visible(timeout=350):
                    continue
                with page.expect_file_chooser(timeout=5000) as fc_info:
                    trigger.click(timeout=2500)
                fc_info.value.set_files(str(cv_path))
                time.sleep(0.5)
                console.print(f"  [dim]  ✓ CV LinkedIn (upload) → {cv_path.name}[/dim]")
                return self._linkedin_wait_cv_upload(scope, cv_path)
            except Exception:
                continue

        roots = [scope]
        try:
            dlg = page.locator('[role="dialog"]').first
            if dlg.count() > 0:
                roots.append(dlg)
        except Exception:
            pass
        roots.append(page)

        for root in roots:
            for sel in (
                "input[name='file']",
                "input[type='file'][accept*='pdf' i]",
                "input[type='file'][name*='resume' i]",
                "input[type='file']",
            ):
                try:
                    for fi in root.locator(sel).all()[:3]:
                        if fi.count() == 0:
                            continue
                        fi.set_input_files(str(cv_path), timeout=5000)
                        time.sleep(0.5)
                        console.print(f"  [dim]  ✓ CV LinkedIn (input caché) → {cv_path.name}[/dim]")
                        return self._linkedin_wait_cv_upload(scope, cv_path)
                except Exception:
                    continue

        try:
            with page.expect_file_chooser(timeout=4000) as fc_info:
                scope.locator(
                    ".jobs-document-upload-redesign-card, "
                    ".jobs-document-upload__container, "
                    "[class*='document-upload']"
                ).first.click(timeout=2000)
            fc_info.value.set_files(str(cv_path))
            time.sleep(0.5)
            console.print(f"  [dim]  ✓ CV LinkedIn (zone upload) → {cv_path.name}[/dim]")
            return self._linkedin_wait_cv_upload(scope, cv_path)
        except Exception:
            pass

        console.print("  [yellow]  ⚠ LinkedIn : impossible d'uploader le CV généré[/yellow]")
        return False

    def _linkedin_easy_apply_progress(self, page, cv_path) -> bool:
        """
        Avance dans la modale LinkedIn Easy Apply :
        contact (email/tél) → Suivant → CV généré → Suivant.
        S'arrête si le bouton final « Envoyer la candidature » est visible.
        """
        scope, scope_label = self._get_form_scope(page)
        if scope_label != "dialog":
            return False

        self._dismiss_linkedin_save_draft_dialog(page)

        if self._is_on_submit_page(scope) or self._is_on_submit_page(page):
            return False

        progressed = False

        if self._fill_linkedin_city_fields(scope, page):
            progressed = True
            time.sleep(0.25)

        if self._linkedin_has_visible_contact_inputs(scope) or self._linkedin_is_contact_step(scope):
            console.print("  [cyan]→ LinkedIn : étape contact[/cyan]")
            if self._fill_linkedin_contact_fields(scope, page):
                progressed = True
            if self._fill_linkedin_city_fields(scope, page):
                progressed = True
            time.sleep(0.35)
            self._fill_linkedin_city_fields(scope, page)
            # Ferme explicitement tout dropdown restant avant de cliquer Suivant
            self._close_typeahead_dropdown(page)
            if (
                not self._is_on_submit_page(scope)
                and not self._linkedin_has_blocking_empty_fields(scope)
                and self._click_next_button(scope, page=page)
            ):
                console.print("  [dim]→ LinkedIn contact → Suivant[/dim]")
                self._wait_settled(page, 1500, fast=True)
                progressed = True
                scope, _ = self._get_form_scope(page)
            elif self._linkedin_has_blocking_empty_fields(scope):
                console.print("  [yellow]→ LinkedIn : contact/ville incomplet — pas de Suivant[/yellow]")

        if self._is_on_submit_page(scope) or self._is_on_submit_page(page):
            return progressed

        if self._fill_linkedin_city_fields(scope, page):
            progressed = True
            time.sleep(0.25)
            if (
                not self._is_on_submit_page(scope)
                and not self._linkedin_has_blocking_empty_fields(scope)
                and self._click_next_button(scope, page=page)
            ):
                console.print("  [dim]→ LinkedIn ville → Suivant[/dim]")
                self._wait_settled(page, 1500, fast=True)
                progressed = True
                scope, _ = self._get_form_scope(page)
            elif self._linkedin_has_blocking_empty_fields(scope):
                console.print("  [yellow]→ LinkedIn : ville requise — pas de Suivant[/yellow]")

        if self._is_on_submit_page(scope) or self._is_on_submit_page(page):
            return progressed

        # Questions complémentaires (langues, oui/non, diplômes…)
        try:
            has_q = (
                scope.locator("select").count() > 0
                or scope.locator("input[type='radio']").count() > 0
            )
        except Exception:
            has_q = False
        if has_q or "additional question" in self._linkedin_dialog_step_text(scope):
            console.print("  [cyan]→ LinkedIn : questions complémentaires[/cyan]")
            fields = self._extract_fields(scope)
            usable_q = [f for f in fields if not _is_junk_field(f) and _field_key(f)]
            rule_map = _apply_profile_rules(usable_q)
            by_key = {_field_key(f): f for f in usable_q if _field_key(f)}
            for rk, rv in rule_map.items():
                fi = by_key.get(rk)
                if fi and self._fill_field(scope, page, fi, rv):
                    progressed = True
                    time.sleep(0.25)

        if cv_path and Path(cv_path).exists() and (
            self._linkedin_has_visible_cv_upload(scope) or self._linkedin_is_resume_step(scope)
        ):
            console.print("  [cyan]→ LinkedIn : étape CV[/cyan]")
            if self._linkedin_upload_generated_cv(scope, page, Path(cv_path)):
                progressed = True
            time.sleep(0.5)
            self._dismiss_linkedin_save_draft_dialog(page)
            if not self._is_on_submit_page(scope) and self._click_next_button(scope, page=page):
                console.print("  [dim]→ LinkedIn CV → Suivant[/dim]")
                self._wait_settled(page, 1500, fast=True)
                progressed = True

        return progressed

    # ── LinkedIn : scope du bouton apply (top card, pas offres similaires) ─────

    _LINKEDIN_TOPCARD = (
        ".jobs-details__main-content",
        ".job-details-jobs-unified-top-card",
        ".jobs-unified-top-card",
        ".jobs-details",
        "main",
    )

    def _linkedin_apply_scope(self, page):
        """Zone du haut de l'offre courante — exclut sidebar / offres similaires."""
        for sel in self._LINKEDIN_TOPCARD:
            try:
                loc = page.locator(sel).first
                if loc.count() and loc.is_visible(timeout=600):
                    return loc
            except Exception:
                continue
        return page.locator("body")

    def _linkedin_apply_availability(self, page) -> Dict[str, bool]:
        """Détecte Easy Apply vs Postuler externe sur l'offre courante."""
        try:
            return self._linkedin_apply_scope(page).evaluate(
                """(root) => {
                    root = root || document;
                    const btns = root.querySelectorAll(
                        'button.jobs-apply-button, a.jobs-apply-button'
                    );
                    let easy = false, external = false;
                    const bad = '.jobs-similar-jobs, .jobs-you-might-like, aside.scaffold-layout__aside';
                    for (const b of btns) {
                        if (b.closest(bad)) continue;
                        const t = (b.innerText || b.textContent || b.getAttribute('aria-label') || '')
                            .replace(/\\s+/g, ' ').trim().toLowerCase();
                        const cls = (b.className || '').toString();
                        const extIcon = !!b.querySelector('svg[id*="link-external"], #link-external-medium');
                        if (/candidature simplifi|easy apply|postuler facilement|simplified application/.test(t))
                            easy = true;
                        if (cls.includes('--external') || extIcon
                            || ((/^postuler$|^apply$/.test(t)) && cls.includes('jobs-apply-button')))
                            external = true;
                    }
                    return { easy, external };
                }"""
            ) or {"easy": False, "external": False}
        except Exception:
            return {"easy": False, "external": False}

    def _linkedin_apply_preference(self, page) -> str:
        """
        'easy' | 'external' — choix du bouton Postuler sur LinkedIn.
        Easy Apply prioritaire si les deux existent (plus fiable en auto).
        """
        avail = self._linkedin_apply_availability(page)
        if avail.get("easy") and not avail.get("external"):
            return "easy"
        if avail.get("external") and not avail.get("easy"):
            return "external"
        if avail.get("easy"):
            return "easy"
        if avail.get("external"):
            return "external"
        return "easy"

    def _linkedin_button_kind(self, el) -> str:
        try:
            return el.evaluate(
                """(node) => {
                    if (!node) return 'other';
                    const t = (node.innerText || node.textContent || node.getAttribute('aria-label') || '')
                        .replace(/\\s+/g, ' ').trim().toLowerCase();
                    const cls = (node.className || '').toString();
                    const extIcon = !!node.querySelector('svg[id*="link-external"], #link-external-medium');
                    if (cls.includes('--external') || extIcon) return 'external';
                    if (/candidature simplifi|easy apply|postuler facilement|simplified application/.test(t))
                        return 'easy';
                    if (/^postuler$|^apply$/.test(t)) return 'external';
                    if (cls.includes('jobs-apply-button')) return 'easy';
                    return 'other';
                }"""
            ) or "other"
        except Exception:
            return "other"

    def _pick_linkedin_apply_candidate(self, btn, pref: str):
        """Choisit le bon bouton Postuler parmi plusieurs candidats visibles."""
        candidates: List[Tuple[int, Any]] = []
        order = {"easy": 0, "external": 1, "other": 2}
        if pref == "external":
            order = {"external": 0, "easy": 1, "other": 2}
        try:
            n = min(btn.count(), 10)
        except Exception:
            return None
        for i in range(n):
            cand = btn.nth(i)
            try:
                if not cand.is_visible(timeout=500):
                    continue
                if not self._is_linkedin_apply_el(cand):
                    continue
                kind = self._linkedin_button_kind(cand)
                candidates.append((order.get(kind, 9), cand))
            except Exception:
                continue
        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0])
        return candidates[0][1]

    def _is_linkedin_apply_el(self, el) -> bool:
        """Vrai si bouton apply de l'offre courante (Easy Apply ou Postuler externe)."""
        try:
            return el.evaluate(
                """(node) => {
                    if (!node) return false;
                    const bad = node.closest(
                        '.jobs-similar-jobs, .jobs-you-might-like, .discovery-results, '
                        + '.job-card-container, .jobs-search-results-list, aside.scaffold-layout__aside'
                    );
                    if (bad) return false;
                    const cls = (node.className || '').toString();
                    if (cls.includes('jobs-apply-button')) return true;
                    const aria = (node.getAttribute('aria-label') || '').toLowerCase();
                    if (/candidature simplifi|easy apply|postuler facilement|simplified application/.test(aria))
                        return true;
                    if (/postuler|apply/.test(aria) && !/similaire|similar/.test(aria)) return true;
                    const href = node.getAttribute('href') || '';
                    if (href.includes('/jobs/view/') && !cls.includes('jobs-apply-button'))
                        return false;
                    const tag = (node.tagName || '').toLowerCase();
                    if (tag !== 'button' && tag !== 'a') return false;
                    const own = (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
                    if (/^(candidature simplifi|postuler facilement|easy apply)/.test(own)) return true;
                    if (/^postuler$|^apply$/.test(own)) {
                        if (node.querySelector('svg[id*="link-external"], #link-external-medium')) return true;
                        if (cls.includes('jobs-apply-button')) return true;
                        return true;
                    }
                    return false;
                }"""
            )
        except Exception:
            return False

    def _linkedin_click_postuler_button(
        self, page, popup_url=None, pages_before=None,
    ) -> Tuple[bool, str]:
        """Clic Postuler / Easy Apply dans la top card (texte nested dans spans)."""
        search_root = self._linkedin_apply_scope(page)
        roots = [search_root, page.locator('[role="dialog"]').first, page]
        prefer_external = self._linkedin_apply_preference(page) == "external"

        def _after_click(url_before: str) -> Tuple[bool, str]:
            time.sleep(2.5)
            self._wait_settled(page, timeout_ms=4000)
            if popup_url and popup_url[0]:
                return True, popup_url[0]
            if page.url != url_before:
                return True, page.url
            if pages_before is not None:
                switched = self._switch_to_latest_page(page, pages_before=pages_before)
                if switched.url != page.url or "linkedin.com" not in switched.url:
                    return True, switched.url
            try:
                if page.locator('[role="dialog"]').first.is_visible(timeout=600):
                    return True, page.url
            except Exception:
                pass
            return True, page.url

        for root in roots:
            try:
                if root.count() == 0:
                    continue
            except Exception:
                pass
            try:
                url_before = page.url
                label = root.evaluate(JS_LINKEDIN_CLICK_POSTULER, prefer_external)
                if label:
                    console.print(f"  [dim]→ Clic LinkedIn « {label} » (JS)[/dim]")
                    return _after_click(url_before)
            except Exception:
                continue
        for pat in (
            re.compile(r"^Postuler$", re.I),
            re.compile(r"^Candidature simplifiée$", re.I),
            re.compile(r"^Easy Apply$", re.I),
            re.compile(r"^Postuler facilement$", re.I),
        ):
            try:
                btn = search_root.get_by_role("button", name=pat).first
                if btn.count() == 0 or not btn.is_visible(timeout=500):
                    continue
                if not self._is_linkedin_apply_el(btn):
                    continue
                url_before = page.url
                btn.click(timeout=3000)
                console.print(f"  [dim]→ Clic LinkedIn ({pat.pattern})[/dim]")
                return _after_click(url_before)
            except Exception:
                continue
        try:
            btn = search_root.locator("button").filter(
                has_text=re.compile(r"^Postuler$", re.I)
            ).filter(has=search_root.locator("#link-external-medium, svg[id*='link-external']")).first
            if btn.count() > 0 and btn.is_visible(timeout=500):
                url_before = page.url
                btn.click(timeout=3000)
                console.print("  [dim]→ Clic Postuler externe (link-external)[/dim]")
                return _after_click(url_before)
        except Exception:
            pass
        return False, ""

    def _poll_after_linkedin_apply_click(
        self, page, pages_before, cv_path=None, max_wait_s: float = 10,
    ):
        """
        Après clic Postuler sur LinkedIn : attend un nouvel onglet ATS externe
        ou une modale Easy Apply (sans bloquer 8s sur une modale inexistante).
        """
        url_at_click = page.url
        deadline = time.time() + max_wait_s
        while time.time() < deadline:
            page = self._switch_to_latest_page(page, pages_before=pages_before)
            if "linkedin.com" not in page.url:
                self._wait_settled(page, 2000, fast=True)
                self._dismiss_cookies(page)
                return page
            try:
                if page.locator('[role="dialog"]').first.is_visible(timeout=300):
                    self._dismiss_linkedin_save_draft_dialog(page)
                    if cv_path:
                        self._linkedin_easy_apply_progress(page, cv_path)
                    return page
            except Exception:
                pass
            # Navigation same-tab vers ATS (rare mais possible)
            if page.url != url_at_click and "linkedin.com" not in page.url:
                self._wait_settled(page, 2000, fast=True)
                self._dismiss_cookies(page)
                return page
            time.sleep(0.35)
        self._wait_settled(page, 1200, fast=True)
        self._dismiss_cookies(page)
        return page

    # ── Click sur le bouton "Postuler" / "Apply" ──────────────────────────────

    def _click_apply_button(self, page, ats: str) -> Tuple[bool, str]:
        """
        Cherche et clique sur le bouton d'accès au formulaire.
        Retourne (clicked, new_url_if_redirected).
        Pour les ATS inline (Greenhouse, Lever…), renvoie (False, '').
        """
        if ats in ATS_INLINE_FORM:
            console.print(f"  [dim]ATS inline ({ats}) — pas de bouton à cliquer[/dim]")
            return False, ""

        if ats == "linkedin":
            pref = self._linkedin_apply_preference(page)
            if pref == "external":
                selectors = LINKEDIN_APPLY_SELECTORS_EXTERNAL + LINKEDIN_APPLY_SELECTORS_EASY
            else:
                selectors = LINKEDIN_APPLY_SELECTORS_EASY + LINKEDIN_APPLY_SELECTORS_EXTERNAL
        else:
            selectors = APPLY_BUTTON_SELECTORS.get(ats, []) + APPLY_BUTTON_SELECTORS["_generic"]
        search_root = self._linkedin_apply_scope(page) if ats == "linkedin" else page
        linkedin_pref = self._linkedin_apply_preference(page) if ats == "linkedin" else "easy"

        # LinkedIn : le bouton apply est en haut (top card), pas en bas de page
        try:
            if ats == "linkedin":
                page.evaluate("window.scrollTo(0, 0)")
                time.sleep(0.25)
            else:
                page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                time.sleep(0.35)
                page.evaluate("window.scrollTo(0, 0)")
                time.sleep(0.2)
        except Exception:
            pass

        # Capture les nouveaux onglets/popups (one-shot + context listener)
        popup_url = [""]
        def on_popup(p):
            try:
                p.wait_for_load_state("domcontentloaded", timeout=8000)
                popup_url[0] = p.url
            except Exception:
                pass
        page.once("popup", on_popup)
        pages_before_click = {id(p) for p in self._browser.pages if not p.is_closed()}

        with self._PageClickTracker(page.context) as page_tracker:
            # Patterns OAuth à ne jamais cliquer (demandent une connexion externe)
            OAUTH_SKIP = (
                "via linkedin", "with linkedin", "linkedin ile",
                "via google", "with google",
                "via facebook", "with facebook",
                "via github", "with github",
                "se connecter avec", "sign in with", "continue with",
            )

            def _try_click(btn, label: str) -> Optional[Tuple[bool, str]]:
                try:
                    if btn.count() == 0:
                        return None
                    target = btn.first
                    if ats == "linkedin":
                        picked = self._pick_linkedin_apply_candidate(btn, linkedin_pref)
                        if picked is None:
                            return None
                        target = picked
                    elif not target.is_visible(timeout=1200):
                        return None
                    txt = (target.text_content() or target.get_attribute("aria-label") or "").strip()[:60]
                    if any(oauth in txt.lower() for oauth in OAUTH_SKIP):
                        console.print(f"  [dim]→ Bouton OAuth ignoré : '{txt[:40]}'[/dim]")
                        return None
                    console.print(f"  [dim]→ Clic '{txt[:40]}' ({label[:50]})[/dim]")
                    url_before = page.url
                    try:
                        target.click(timeout=3000)
                    except Exception as e:
                        console.print(f"  [yellow]    clic intercepté : {str(e)[:60]}[/yellow]")
                        try:
                            target.click(timeout=3000, force=True)
                        except Exception:
                            return None

                    post_wait = 1.0 if ats == "linkedin" else 2.5
                    time.sleep(post_wait)
                    self._wait_settled(page, timeout_ms=2000 if ats == "linkedin" else 4000, fast=ats == "linkedin")
                    resolved = self._resolve_url_after_click(
                        page, url_before, popup_url, page_tracker, pages_before_click,
                    )
                    if resolved != url_before or popup_url[0] or page_tracker.new_pages:
                        return True, resolved
                    try:
                        if page.locator('[role="dialog"]').first.is_visible(timeout=600):
                            console.print(f"  [dim]✓ Modale détectée après clic[/dim]")
                            return True, page.url
                    except Exception:
                        pass
                    return True, page.url
                except Exception:
                    return None

            for sel in selectors:
                try:
                    root = search_root if ats == "linkedin" else page
                    result = _try_click(root.locator(sel), sel)
                    if result:
                        return result
                except Exception:
                    continue

            # LinkedIn : fallback strict dans la top card uniquement
            if ats == "linkedin":
                linkedin_apply_re = re.compile(
                    r"^(Candidature simplifi|Postuler facilement|Easy Apply|Postuler|Apply)",
                    re.I,
                )
                try:
                    btn = search_root.locator("button.jobs-apply-button, a.jobs-apply-button")
                    result = _try_click(btn, "jobs-apply-button (top card)")
                    if result:
                        return result
                except Exception:
                    pass
                for role in ("button", "link"):
                    try:
                        btn = search_root.get_by_role(role, name=linkedin_apply_re)
                        result = _try_click(btn, f"get_by_role({role})")
                        if result:
                            return result
                    except Exception:
                        continue
                js_clicked, js_url = self._linkedin_click_postuler_button(
                    page, popup_url=popup_url, pages_before=pages_before_click,
                )
                if js_clicked:
                    tracked = page_tracker.best_page(page, pages_before_click)
                    if tracked is not None:
                        try:
                            return True, tracked.url
                        except Exception:
                            pass
                    return True, js_url

        return False, ""

    # ── Pause utilisateur ─────────────────────────────────────────────────────

    # Patterns de confirmation après soumission (FR + EN)
    CONFIRMATION_PATTERNS = (
        # FR
        "candidature a été envoyée",
        "candidature a bien été envoyée",
        "candidature a bien été reçue",
        "candidature a bien été soumise",
        "candidature envoyée",
        "candidature soumise",
        "merci pour votre candidature",
        "merci d'avoir postulé",
        "nous avons bien reçu votre candidature",
        "votre demande a bien été envoyée",
        "candidature transmise",
        # EN
        "application has been submitted",
        "application was submitted",
        "application has been sent",
        "application sent",
        "application submitted",
        "application received",
        "thank you for applying",
        "thanks for applying",
        "thank you for your application",
        "we received your application",
        "we've received your application",
        "successfully applied",
        "submission successful",
        "your application is in",
    )

    def _save_failure_screenshot(self, page, app_dir: Optional[Path], reason: str) -> str:
        """
        Sauvegarde un screenshot d'échec dans app_dir/auto_apply_error.png
        + un fichier auto_apply_error.json avec la raison.
        Retourne le chemin relatif du screenshot (depuis BASE_DIR) ou "".
        """
        self._auto_submit_screenshot = ""
        if not app_dir:
            return ""
        try:
            screenshot_path = app_dir / "auto_apply_error.png"
            page.screenshot(path=str(screenshot_path), full_page=True, timeout=8000)
            # Stocke aussi la raison + URL pour le dashboard
            (app_dir / "auto_apply_error.json").write_text(
                json.dumps({
                    "reason": reason,
                    "url":    page.url,
                    "at":     datetime.now().isoformat(timespec="seconds"),
                }, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            # Chemin relatif par rapport au répertoire du projet (servable par state_server)
            try:
                rel = screenshot_path.relative_to(app_dir.parent.parent)
                rel_str = str(rel)
            except Exception:
                rel_str = str(screenshot_path)
            self._auto_submit_screenshot = rel_str
            console.print(f"  [dim]📸 Screenshot d'échec : {rel_str}[/dim]")
            return rel_str
        except Exception as e:
            console.print(f"  [dim]⚠ Screenshot échec : {str(e)[:60]}[/dim]")
            return ""

    def _auto_submit_and_verify(self, page, app_dir: Optional[Path] = None) -> bool:
        """
        Clique le bouton Submit final puis vérifie qu'un message de confirmation
        apparaît. Retourne True uniquement si la confirmation est détectée.
        """
        console.print(f"\n  [bold cyan]── Soumission automatique ──[/bold cyan]")
        self._auto_submit_screenshot = ""

        # Cherche un bouton Submit visible
        submit_btn = None
        for sel in SUBMIT_SELECTORS:
            try:
                btn = page.locator(sel).first
                if btn.count() and btn.is_visible(timeout=600):
                    submit_btn = btn
                    break
            except Exception:
                continue

        if not submit_btn:
            console.print("  [yellow]⚠ Bouton Submit introuvable — soumission impossible[/yellow]")
            self._auto_submit_message = "Bouton Submit introuvable"
            self._save_failure_screenshot(page, app_dir, "Bouton Submit introuvable")
            return False

        try:
            txt = (submit_btn.text_content() or "").strip()[:30]
            console.print(f"  → Clic Submit '{txt}'")
            submit_btn.scroll_into_view_if_needed(timeout=2000)
            submit_btn.click(timeout=5000)
        except Exception as e:
            reason = f"Clic Submit échoué : {str(e)[:80]}"
            console.print(f"  [yellow]⚠ {reason}[/yellow]")
            self._auto_submit_message = reason
            self._save_failure_screenshot(page, app_dir, reason)
            return False

        # Attend que la page traite la soumission
        try:
            page.wait_for_load_state("networkidle", timeout=15_000)
        except Exception:
            pass
        time.sleep(2.5)

        # Vérification : cherche un message de confirmation dans le body OU URL
        url_after = (page.url or "").lower()
        url_success = any(pat in url_after for pat in (
            "/thank", "/thanks", "/confirm", "/success", "/applied",
            "/submitted", "/merci", "/confirmation",
        ))

        body_text = ""
        try:
            body_text = (page.evaluate("() => document.body && document.body.innerText || ''") or "").lower()
        except Exception:
            pass

        matched = next(
            (p for p in self.CONFIRMATION_PATTERNS if p in body_text),
            None,
        )

        if matched:
            self._auto_submit_message = matched
            console.print(f"  [bold green]✅ Confirmation détectée : « {matched} »[/bold green]")
            return True
        if url_success:
            self._auto_submit_message = f"URL de succès : {url_after[:60]}"
            console.print(f"  [bold green]✅ URL de succès : {url_after[:60]}[/bold green]")
            return True

        console.print(f"  [yellow]⚠ Aucune confirmation détectée — soumission incertaine[/yellow]")
        console.print(f"  [dim]URL : {url_after[:80]}[/dim]")
        self._auto_submit_message = "Pas de confirmation visible après clic Submit"
        self._save_failure_screenshot(page, app_dir, self._auto_submit_message)
        return False

    def _pause_for_review(self, page, all_filled: List[str], pages_recap: Optional[List[Dict]] = None):
        console.print()
        if pages_recap:
            console.print(f"  [bold cyan]── Récapitulatif des {len(pages_recap)} page(s) ──[/bold cyan]")
            for i, rec in enumerate(pages_recap, 1):
                fields = rec.get("filled", [])
                indicator = rec.get("step", "")
                hdr = f"  Page {i}" + (f" [{indicator}]" if indicator else "")
                console.print(f"  [bold]{hdr}[/bold] — {len(fields)} champ(s) rempli(s)")
                for k in fields:
                    console.print(f"    [dim]· {k}[/dim]")
        else:
            console.print(f"  [bold green]✅ Champs remplis : {', '.join(all_filled) if all_filled else '(aucun)'}[/bold green]")
        console.print(f"\n  [bold yellow]→ Vérifie le formulaire dans le navigateur.[/bold yellow]")
        console.print(f"  [bold yellow]→ Clique Submit toi-même quand tu es prêt, puis appuie sur Entrée ici.[/bold yellow]")
        try:
            input("  [Entrée pour fermer] ")
        except Exception:
            time.sleep(15)

    # ── fill (legacy, sélecteurs statiques) ───────────────────────────────────

    def fill(self, job: Dict, cv_path: Path, letter_text: str = "") -> bool:
        url = job.get("url", "")
        if not url:
            console.print("[red]  Pas d'URL pour cette offre[/red]")
            return False

        self._ensure_browser()
        page = self._browser.new_page()
        ats  = detect_ats(url)
        console.print(f"\n  [bold]Ouverture[/bold] {url[:70]}")
        console.print(f"  Platform détectée : [cyan]{ats}[/cyan]")

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            time.sleep(random.uniform(1.5, 2.5))

            if ats == "linkedin":
                if self._ensure_linkedin_logged_in(page):
                    page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                    time.sleep(2)
                    self._click_apply_button(page, "linkedin")
                    time.sleep(2)
            elif ats not in ATS_INLINE_FORM:
                self._click_apply_button(page, ats)
                time.sleep(2)

            filled = _fill_generic(page, cv_path, letter_text)
            self._pause_for_review(page, filled)
            return True
        except Exception as e:
            console.print(f"  [red]Erreur autofill : {e}[/red]")
            self._screenshot(page, "fill_error")
            return False

    # ── train ─────────────────────────────────────────────────────────────────

    def _ensure_linkedin_logged_in(self, page) -> bool:
        """
        Vérifie si on est loggué LinkedIn via le cookie li_at.
        N'ouvre la page /feed/ que si on n'est PAS loggué (pour le login manuel).
        Évite le détour systématique par la home LinkedIn.
        """
        # 1. Check rapide via cookies (pas de navigation)
        try:
            cookies = self._browser.cookies("https://www.linkedin.com")
            has_li_at = any(c.get("name") == "li_at" and c.get("value") for c in cookies)
            if has_li_at:
                console.print("  [green]✓ LinkedIn connecté (cookie)[/green]")
                return True
        except Exception:
            pass

        # 2. Sinon : on doit prompt le user. Va sur /feed/ pour qu'il se connecte.
        console.print("\n  [bold yellow]⚠  LinkedIn non connecté.[/bold yellow]")
        try:
            page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=20_000)
            time.sleep(2)
        except Exception:
            pass
        if "/login" in page.url or "/checkpoint" in page.url or "/authwall" in page.url:
            console.print("  [yellow]→ Connecte-toi dans la fenêtre qui vient de s'ouvrir.[/yellow]")
            if sys.stdin.isatty():
                console.print("  [yellow]→ Une fois connecté, appuie sur Entrée ici.[/yellow]")
                try:
                    input("  [Entrée une fois connecté] ")
                except Exception:
                    time.sleep(30)
            else:
                # Lancé depuis le dashboard web : pas de terminal → on attend
                # que le cookie li_at apparaisse (login détecté), max 5 min.
                console.print("  → Connectez-vous à LinkedIn dans la fenêtre Chromium (5 min max)…")
                deadline = time.time() + 300
                while time.time() < deadline:
                    time.sleep(5)
                    try:
                        cookies = self._browser.cookies("https://www.linkedin.com")
                        if any(c.get("name") == "li_at" and c.get("value") for c in cookies):
                            break
                    except Exception:
                        break
            # Re-check cookie
            try:
                cookies = self._browser.cookies("https://www.linkedin.com")
                if any(c.get("name") == "li_at" and c.get("value") for c in cookies):
                    console.print("  [green]✓ LinkedIn connecté[/green]")
                    return True
            except Exception:
                pass
            if "/login" in page.url or "/checkpoint" in page.url:
                console.print("  [red]Toujours non connecté — abandon LinkedIn.[/red]")
                return False
        console.print("  [green]✓ LinkedIn connecté[/green]")
        return True

    def train(self, urls: List[str]):
        self._ensure_browser()
        console.print(f"\n[bold cyan]Mode Training — {len(urls)} URL(s)[/bold cyan]\n")

        linkedin_checked = False
        linkedin_ok      = True

        for i, url in enumerate(urls, 1):
            ats = detect_ats(url)
            console.print(f"\n[{i}/{len(urls)}] [bold]{ats.upper()}[/bold] — {url[:70]}")
            page = self._browser.new_page()
            try:
                if ats == "linkedin":
                    if not linkedin_checked:
                        linkedin_ok = self._ensure_linkedin_logged_in(page)
                        linkedin_checked = True
                    if not linkedin_ok:
                        console.print("  [yellow]Ignoré (non connecté)[/yellow]")
                        page.close()
                        continue
                    page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                    self._wait_settled(page, 4000)
                    self._dismiss_cookies(page)

                    linkedin_tab = page
                    _pb_tr_li = {id(p) for p in self._browser.pages if not p.is_closed()}
                    clicked, new_url = self._click_apply_button(page, "linkedin")
                    page = self._switch_to_latest_page(page, pages_before=_pb_tr_li)
                    self._wait_settled(page, 4000)
                    self._dismiss_cookies(page)

                    # Ferme l'onglet LinkedIn si on a redirigé ailleurs
                    if "linkedin.com" not in page.url and linkedin_tab is not page:
                        try:
                            if not linkedin_tab.is_closed():
                                linkedin_tab.close()
                        except Exception:
                            pass

                    # Si redirect externe, clique aussi son bouton Postuler
                    if "linkedin.com" not in page.url:
                        new_ats = detect_ats_page(page)
                        console.print(f"  [cyan]→ ATS externe : {new_ats} ({page.url[:55]})[/cyan]")
                        if new_ats not in ATS_INLINE_FORM:
                            _pb_tr_ats = {id(p) for p in self._browser.pages if not p.is_closed()}
                            self._click_apply_button(page, new_ats)
                            page = self._switch_to_latest_page(page, pages_before=_pb_tr_ats)
                            self._wait_settled(page, 4000)
                            self._dismiss_cookies(page)
                else:
                    page.goto(url, wait_until="domcontentloaded", timeout=20_000)
                    self._wait_settled(page, 4000)
                    self._dismiss_cookies(page)
                    if ats not in ATS_INLINE_FORM:
                        _pb_tr_other = {id(p) for p in self._browser.pages if not p.is_closed()}
                        self._click_apply_button(page, ats)
                        page = self._switch_to_latest_page(page, pages_before=_pb_tr_other)
                        self._wait_settled(page, 4000)
                        self._dismiss_cookies(page)
                    time.sleep(1.5)

                # Inspection
                scope, scope_label = self._get_form_scope(page)
                console.print(f"  [dim]Scope d'inspection : {scope_label}[/dim]")
                fields = self._extract_fields(scope)
                # Si la dialog est vide, fallback sur la page
                if not fields and scope_label == "dialog":
                    fields = self._extract_fields(page)
                # Iframes
                if not fields:
                    for fr in self._get_form_frames(page):
                        if fr == page.main_frame:
                            continue
                        ff = self._extract_fields(fr)
                        if ff:
                            console.print(f"  [dim]Champs trouvés dans iframe : {fr.url[:60]}[/dim]")
                            fields = ff
                            break

                indicator = self._get_step_indicator(page)
                if indicator:
                    console.print(f"  [dim]Indicateur : {indicator}[/dim]")

                if fields:
                    console.print(f"  [green]{len(fields)} champ(s) :[/green]")
                    for f in fields:
                        label = f["label"].strip() or f["placeholder"].strip() or f["name"] or f["id"] or "?"
                        extra = []
                        if f["type"]:           extra.append(f["type"])
                        if f["required"]:       extra.append("required")
                        if f["accept"]:         extra.append(f"accept={f['accept']}")
                        if f["options"]:        extra.append(f"{len(f['options'])} options")
                        ext = f" \\[{', '.join(extra)}]" if extra else ""
                        console.print(f"    \\[{f['tag']}] {label[:60]}{ext}")
                else:
                    console.print("  [yellow]Aucun champ détecté[/yellow]")
                    self._screenshot(page, f"train_no_fields_{i}")

                time.sleep(1.5)
            except Exception as e:
                console.print(f"  [red]Erreur : {e}[/red]")
                self._screenshot(page, f"train_error_{i}")
            finally:
                try:
                    page.close()
                except Exception:
                    pass
                time.sleep(0.6)

        console.print("\n[bold green]Training terminé.[/bold green]")

    # ── Smart Fill (IA) ───────────────────────────────────────────────────────

    def _update_answer_bank(self, bank: dict, mapping: dict, fields: list, job: dict):
        """
        Ajoute au bank cross-app les réponses GÉNÉRIQUES uniquement
        (questions qui ne contiennent pas le nom de l'entreprise).
        """
        company_lower = (job.get("company") or "").lower().strip()
        # Skip les noms trop courts (risque de faux positif)
        skip_company = len(company_lower) >= 3
        # Skip les valeurs marker (CV/lettre) et les valeurs trop spécifiques
        SKIP_VALUES = {"__CV_FILE__", "__COVER_LETTER__"}

        label_by_key: Dict[str, str] = {}
        for f in fields:
            for k in (f.get("id"), f.get("name")):
                if k and k not in label_by_key:
                    label_by_key[k] = f.get("label") or ""

        added = 0
        for k, v in mapping.items():
            if v in SKIP_VALUES or not v:
                continue
            lbl = label_by_key.get(k, "")
            if not lbl:
                continue
            # Skip questions company-specific
            lbl_lower = lbl.lower()
            if skip_company and company_lower in lbl_lower:
                continue
            # Skip réponses très longues (probablement contextuelles à l'offre)
            if len(str(v)) > 250:
                continue
            norm = _normalize_question(lbl)
            if not norm or len(norm) < 5:
                continue
            # N'écrase pas une entrée existante (l'utilisateur peut avoir édité à la main)
            if norm in bank:
                continue
            bank[norm] = v
            added += 1

        if added:
            _save_answer_bank(bank)
            console.print(f"  [dim]💾 Bank cross-app : +{added} entrée(s) génériques[/dim]")

    def _ai_visual_recover(self, page, api_key: str, step: int) -> Optional[str]:
        """
        Prend un screenshot et demande à Claude (vision) ce qu'il faut faire.
        Retourne "click:<selector_css>" ou "next" ou None si Claude ne sait pas.

        Utilisé quand :
        - 0 champ détecté par le JS d'extraction
        - Le bot ne sait pas naviguer

        Exécute directement l'action recommandée (clic ou Suivant).
        """
        try:
            import anthropic, base64
            client = anthropic.Anthropic(api_key=api_key)

            screenshot_path = self._screenshot(page, f"ai_recover_step_{step + 1}")
            if not screenshot_path or not screenshot_path.exists():
                return None

            img_data = base64.standard_b64encode(screenshot_path.read_bytes()).decode()

            prompt = """You are controlling a browser filling a job application form.

Look at this screenshot. Determine what to do next to advance the form.

RULES:
- If you see a form with unfilled required fields, return: FILL_NEEDED
- If you see a "Next" / "Suivant" / "Continuer" button and no required unfilled fields, return: CLICK_NEXT
- If you see a "Submit" / "Envoyer la candidature" / "Soumettre" button (final submission), return: STOP
- If you see a cookie banner, return: CLICK_NEXT (will be handled separately)
- If you see nothing actionable, return: UNKNOWN

Return ONLY one of: FILL_NEEDED, CLICK_NEXT, STOP, UNKNOWN — nothing else."""

            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=20,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": img_data,
                        }},
                        {"type": "text", "text": prompt},
                    ],
                }],
            )
            decision = (response.content[0].text or "").strip().upper()
            console.print(f"  [magenta]🤖 Vision IA → {decision}[/magenta]")
            return decision
        except Exception as e:
            console.print(f"  [dim]Vision IA indisponible : {str(e)[:60]}[/dim]")
            return None

    def _ai_map_fields(self, fields: list, api_key: str, model: str,
                       letter_text: str, job: Optional[dict] = None) -> dict:
        """
        Demande à Claude de mapper chaque champ à une valeur du candidat.
        Retourne {field_key: value}.
        """
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        fields_summary = []
        for f in fields:
            key = _field_key(f)
            if not key:
                continue
            info = {"key": key, "tag": f["tag"], "type": f["type"], "label": f.get("label", "")}
            if f.get("placeholder") and f["placeholder"] != f.get("label"):
                info["placeholder"] = f["placeholder"]
            if f.get("accept"):
                info["accept"] = f["accept"]
            if f.get("required"):
                info["required"] = True
            if f.get("options"):
                info["options"] = [o["t"] for o in f["options"][:20]]
            if f.get("value"):  # value pour les radios/checkboxes
                info["value"] = f["value"]
            fields_summary.append(info)

        if not fields_summary:
            return {}

        # Ne pas envoyer de valeurs vides à Claude : elles polluent le mapping
        # (il croit que le profil est vide et skippe des champs remplissables).
        candidate_payload = {
            k: v for k, v in CANDIDATE.items()
            if v not in ("", None, [])
        }
        if candidate_payload.get("cv_summary"):
            candidate_payload["experience_notes"] = candidate_payload.pop("cv_summary")

        # Contexte du job (entreprise, titre du poste) pour les questions ouvertes
        job_context = ""
        if job:
            company = job.get("company") or ""
            title   = job.get("title") or ""
            desc    = (job.get("description") or "")[:600]
            if company or title:
                job_context = f"\nJOB:\n  Company: {company}\n  Role: {title}"
                if desc:
                    job_context += f"\n  Description excerpt: {desc.strip()}"

        # Extrait de la lettre de motivation pour réutilisation dans les réponses ouvertes
        letter_excerpt = letter_text[:800] if letter_text else ""

        prompt = f"""You are filling a job application form for a candidate. Map each form field to the correct value.

CANDIDATE PROFILE:
{json.dumps(candidate_payload, ensure_ascii=False)}{job_context}

FORM FIELDS (key = unique field key from the JSON below; for radio/checkbox without id, the key is "name::value"):
{json.dumps(fields_summary, ensure_ascii=False, indent=2)}

WRITING STYLE FOR FREE-TEXT ANSWERS — IMPORTANT:
- Simple, natural human English. Short sentences (max ~15 words each).
- NO em-dashes (—). NO hyphens used as punctuation (do not write "I am a builder - I love shipping").
- Sound like a real person typing. Say "I built X" not "I architected and orchestrated X".
- 2 to 4 short sentences max for "Why this company?" / experience questions.
- Match the question's language: French question -> French answer, English -> English.
- No buzzwords stacking. No "I am thrilled / passionate about" filler.

MAPPING RULES:
- Return ONLY a JSON object {{key: value}} using the exact "key" string from the FORM FIELDS above.
- Cover letter / lettre de motivation / motivation textarea -> "__COVER_LETTER__"
- CV / resume / file input (type=file with accept containing pdf, OR labels mentioning resume/CV/upload/drop your CV) -> "__CV_FILE__"
- Phone: use phone / phone_intl / phone_national / phone_local from CANDIDATE PROFILE. If country code is a separate field, use phone_local (9 digits, no leading 0). Spaced international for single full phone fields.
- Select: use the EXACT option text from 'options' (case-sensitive).
- Radio buttons (type=radio): return the KEY of the radio to CHECK. The value can be the option label, doesn't matter for the click; the key is what selects the option.
  - Work authorization in France/EU/Schengen -> pick the "Yes" option (candidate is French citizen, no visa needed).
  - Visa sponsorship needed / "Avez-vous besoin d'un visa" -> pick "No".
  - "How did you hear about us" / "Comment avez-vous decouvert" -> pick "LinkedIn" (or closest match like "Job board" / "Online" / "Social media").
  - Gender / sex -> pick "Prefer not to disclose" / "Prefer not to say" if available, otherwise skip.
  - Availability with choices -> pick "Within a month" / "1 month" or closest to end-of-May 2026.
- Checkbox (type=checkbox): return the key with value "Yes" to check. RGPD/consent/terms checkboxes: always "Yes". Skip optional marketing opt-ins.
- "How did you hear about us" as TEXT input: use how_did_you_hear from profile (usually "LinkedIn")
- Salary / Compensation: use salary_expectation / salary_min from CANDIDATE PROFILE
- Location / City / Country: use location, city, country, address, postcode from CANDIDATE PROFILE
- Availability / start date: use availability / earliest_start_date from profile
- Years of experience: use years_of_experience from profile
- English / French level / proficiency in English or French: pick the closest SELECT option to english_level_en / french_level_en (e.g. "Professional working proficiency", "Native or bilingual proficiency"). NEVER leave "None" or "Select an option".
- Yes/No radio questions (commuting, hybrid, remote, visa, education level): return the KEY of the Yes or No radio to CHECK.
- Master's / Bachelor's education completed: Yes if profile suggests so.
- Languages: use languages_fluent / languages_fr from profile
- Open questions about experience: draw from experience_notes / tagline / cv_summary in profile — real facts only, no invention
- "I certify the information is true" / consent / "Je certifie" SELECT or COMBOBOX: pick "Yes" / "Oui" / "I agree" / closest affirmative option
- "I understand the privacy policy" / GDPR consent SELECT: pick "Yes" / "I agree" / closest affirmative
- "Are you legally authorised to work" SELECT or COMBOBOX: pick "Yes" (candidate is French, no visa needed)
- "In what cities are you available" COMBOBOX: "Paris"
- "Why this company" / "Pourquoi nous" / "Why X?" textareas: 2-3 short simple sentences using the JOB context. Be specific to that company. If a cover letter excerpt is provided below, draw concrete points from it but rewrite shorter and simpler. NO em-dashes. NO hyphens as punctuation.
- Experience open questions: 1-2 short sentences from experience_notes / tagline in CANDIDATE PROFILE.
- Disability / "Special assistance" / "Accommodations": "No"
- Gender / Ethnicity / Veteran: "Prefer not to say" / "I am not a protected veteran" / equivalent
- Fun questions (favorite restaurant): plausible Paris answer ("Le Mary Celeste in Paris").
- Required fields: ALWAYS try to fill them. Skip only truly unanswerable.
- No explanation, only valid JSON. No markdown. No code fences.

COVER LETTER EXCERPT (rewrite shorter and simpler, do not copy verbatim, no em-dashes):
{letter_excerpt}

Example output:
{{"first_name": "Marie", "email": "marie.dupont@example.com", "cv_upload": "__CV_FILE__", "work_auth::yes": "Yes", "salary": "55000", "why_company": "What you are building lines up with my background. The mix of product and operations fits what I do best. I would love to bring that to your team."}}"""

        msg = client.messages.create(
            model=model,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}]
        )
        text = msg.content[0].text.strip()

        for chunk in [text] + (text.split("```") if "```" in text else []):
            chunk = chunk.strip()
            if chunk.startswith("json"):
                chunk = chunk[4:].strip()
            try:
                result = json.loads(chunk)
                if isinstance(result, dict):
                    return result
            except Exception:
                continue

        console.print(f"  [yellow]⚠ Claude n'a pas retourné de JSON valide : {text[:120]}[/yellow]")
        return {}

    def _resolve_locator(self, scope, field: dict):
        """Retourne le premier locator visible/présent pour ce champ.

        Pour les radios/checkboxes avec name+value, utilise [name="X"][value="Y"]
        afin de cibler la bonne option du groupe.
        """
        fid   = field.get("id", "")
        fname = field.get("name", "")
        fval  = field.get("value", "") or ""
        ftype = field.get("type", "")
        selectors = []
        if fid:
            safe_id = fid.replace('"', '\\"')
            selectors.append(f'[id="{safe_id}"]')
        if fname and fval and ftype in ("radio", "checkbox"):
            safe_name = fname.replace('"', '\\"')
            safe_val  = fval.replace('"', '\\"')
            selectors.append(f'[name="{safe_name}"][value="{safe_val}"]')
        if fname:
            safe_name = fname.replace('"', '\\"')
            selectors.append(f'[name="{safe_name}"]')
        for sel in selectors:
            try:
                loc = scope.locator(sel).first
                if loc.count() > 0:
                    return loc, sel
            except Exception:
                continue
        return None, None

    def _fill_field(self, scope, page, field: dict, value: str,
                    cv_path=None, letter_text: str = "", force_sequential: bool = False) -> bool:
        """Remplit un champ en gérant React events, file inputs cachés, textareas longs."""
        ftag  = field.get("tag", "input")
        ftype = field.get("type", "text")
        fid   = field.get("id", "")
        fname = field.get("name", "")
        flabel = (field.get("label") or "").lower()
        key = fid or fname or "?"

        loc, sel = self._resolve_locator(scope, field)
        if loc is None:
            console.print(f"  [yellow]  ⚠ {key} : sélecteur introuvable[/yellow]")
            return False

        # ── File upload (accepte les inputs cachés) ──────────────────────────
        if ftype == "file" or value == "__CV_FILE__":
            if not cv_path or not Path(cv_path).exists():
                return False
            cv_p = Path(cv_path)
            if "linkedin.com" in (page.url or ""):
                if self._linkedin_upload_generated_cv(scope, page, cv_p):
                    return True
            # 1. Essaie d'abord via le file chooser (clic sur label/bouton) — plus
            #    fiable pour les ATSes React (LinkedIn, Workday…) qui ignorent
            #    set_input_files sur l'input caché mais mettent à jour la UI.
            if self._upload_cv_via_chooser(page, Path(cv_path), scope=scope, label_for=fid):
                return True
            # 2. Fallback : set_input_files direct (marche sur inputs display:none)
            try:
                loc.set_input_files(str(cv_path), timeout=5000)
                time.sleep(1)
                console.print(f"  [dim]  ✓ CV uploadé → {Path(cv_path).name} (sur '{key}')[/dim]")
                return True
            except Exception as e:
                console.print(f"  [yellow]  ⚠ Upload {key} échoué : {str(e)[:80]}[/yellow]")
                return False

        # ── Radio / Checkbox ─────────────────────────────────────────────────
        if ftype == "radio" or ftype == "checkbox":
            try:
                try:
                    loc.scroll_into_view_if_needed(timeout=1500)
                except Exception:
                    pass
                try:
                    loc.check(timeout=2000)
                except Exception:
                    # Fallback : clic via label
                    if fid:
                        try:
                            page.locator(f'label[for="{fid}"]').first.click(timeout=2000)
                        except Exception:
                            loc.click(timeout=2000, force=True)
                    else:
                        loc.click(timeout=2000, force=True)
                console.print(f"  [dim]  ✓ {key} ({ftype}) coché[/dim]")
                return True
            except Exception as e:
                console.print(f"  [yellow]  ⚠ {ftype} {key} échoué : {str(e)[:60]}[/yellow]")
                return False

        # ── Cover letter ─────────────────────────────────────────────────────
        if value == "__COVER_LETTER__":
            value = letter_text
        if value is None or value == "":
            return False
        value = str(value)

        # ── Adaptation du téléphone selon placeholder ─────────────────────────
        if ftype == "tel" or "phone" in flabel or "téléphone" in flabel or "mobile" in flabel:
            ph = (field.get("placeholder") or "")
            aria = (field.get("label") or "").lower()
            country_separate = any(
                x in aria or x in ph
                for x in ("indicatif", "country code", "code pays", "+33")
            )
            if country_separate or (ph and re.search(r"^\+33\s*6", ph)):
                value = CANDIDATE.get("phone_local") or CANDIDATE.get("phone_national", value).lstrip("0")
            elif ph and re.search(r'^0\d', ph) and not str(value).startswith("0"):
                value = CANDIDATE.get("phone_national", value)
            elif re.search(r'\+\d{11,}', str(value).replace(" ", "")):
                value = CANDIDATE.get("phone", value)

        # ── Combobox / typeahead (role=combobox, aria-autocomplete=list, "Start typing…") ──
        if field.get("combobox") and ftag != "select":
            is_city = _is_city_like_field(flabel, field.get("placeholder") or "")
            is_linkedin = "linkedin.com" in (page.url or "")
            if is_linkedin and is_city:
                q, hints = _linkedin_city_typeahead_query()
                if self._linkedin_typeahead_select(scope, page, loc, q, hints):
                    return True
            try:
                try:
                    loc.scroll_into_view_if_needed(timeout=1500)
                except Exception:
                    pass
                loc.click(timeout=2000)
                time.sleep(0.4)

                def _get_options():
                    """Récupère toutes les options visibles dans le listbox."""
                    opts = []
                    # Greenhouse / React Select listbox via aria-controls
                    ctrl_id = field.get("id", "")
                    if ctrl_id:
                        lb_id = f"react-select-{ctrl_id}-listbox"
                        lb_locs = page.locator(f'#{lb_id} [role="option"]').all()
                        if lb_locs:
                            return lb_locs
                    if is_linkedin:
                        li_opts = self._linkedin_collect_typeahead_options(scope, page)
                        if li_opts:
                            return li_opts
                    # Fallback : n'importe quelle option visible
                    return page.locator('[role="option"]:visible, [class*="select__option"]:visible').all()

                # 1ère tentative : clic seul ouvre le dropdown (dropdown-only React Select)
                opt_locs = []
                for _ in range(3):
                    opt_locs = _get_options()
                    if opt_locs:
                        break
                    time.sleep(0.4)

                # 2ème tentative : tape un fragment pour filtrer (typeahead)
                if not opt_locs:
                    if is_city and is_linkedin:
                        query, _ = _linkedin_city_typeahead_query()
                    else:
                        query = value.split(",")[0].split("(")[0].strip()
                        if re.search(r'saint|seine|ouen|boulogne|montreuil|vincennes|ivry', query, re.I):
                            query = "Paris"
                    try:
                        loc.fill("", timeout=800)
                    except Exception:
                        pass
                    type_len = 24 if is_city else 6
                    loc.press_sequentially(query[:type_len], delay=85 if is_city else 60)
                    time.sleep(1.2 if is_city else 1.0)
                    for _ in range(3):
                        opt_locs = _get_options()
                        if opt_locs:
                            break
                        time.sleep(0.4)

                if opt_locs:
                    # Cherche la meilleure option par correspondance textuelle
                    vl = value.lower()
                    best = None
                    for o in opt_locs[:15]:
                        t = (o.text_content() or "").strip().lower()
                        if not t:
                            continue
                        # Match exact d'abord
                        if t == vl:
                            best = o
                            break
                        # Contient la valeur ou la valeur contient le texte
                        if vl in t or t in vl:
                            best = o
                            break
                        # Match sur un mot clé (ex: "Courant" dans "Niveau courant")
                        words_v = [w for w in vl.split() if len(w) > 2]
                        if any(w in t for w in words_v):
                            if not best:
                                best = o
                    target = best or opt_locs[0]
                    chosen = (target.text_content() or "").strip()
                    target.click(timeout=2000)
                    time.sleep(0.4)
                    console.print(f"  [dim]  ✓ combobox [{key}] → '{chosen[:40]}'[/dim]")

                    # Multi-select (langues) : sélectionne les options suivantes
                    values_list = [v.strip() for v in value.split(",") if v.strip()]
                    if len(values_list) > 1:
                        for extra_val in values_list[1:]:
                            time.sleep(0.3)
                            extra_opts = _get_options()
                            ev = extra_val.lower()
                            for o in extra_opts[:15]:
                                t = (o.text_content() or "").strip().lower()
                                if ev in t or t in ev:
                                    o.click(timeout=1500)
                                    console.print(f"  [dim]    + multi-select → '{t[:30]}'[/dim]")
                                    break
                    # Ferme le dropdown
                    try:
                        page.keyboard.press("Escape")
                    except Exception:
                        pass
                    return True
                else:
                    try:
                        page.keyboard.press("Escape")
                    except Exception:
                        pass
                    if is_city or is_linkedin:
                        page.keyboard.press("ArrowDown")
                        time.sleep(0.3)
                        page.keyboard.press("Enter")
                        time.sleep(0.4)
                        try:
                            val = (loc.input_value(timeout=800) or "").strip()
                        except Exception:
                            val = ""
                        if val:
                            console.print(f"  [dim]  ✓ combobox [{key}] → '{val[:40]}' (clavier)[/dim]")
                            return True
                    console.print(f"  [yellow]  ⚠ combobox [{key}] : aucune option trouvée pour '{value[:30]}'[/yellow]")
            except Exception as e:
                console.print(f"  [yellow]  ⚠ combobox [{key}] : {str(e)[:60]}[/yellow]")
            # Si le combobox a échoué, on tente le fill normal (input text fallback)

        # ── Select ───────────────────────────────────────────────────────────
        if ftag == "select":
            try:
                if not loc.is_visible(timeout=600):
                    return False
                opts = field.get("options") or []
                picked = _match_select_option_text(opts, [value]) or value
                ok = False
                for attempt in (
                    {"label": picked},
                    {"value": picked},
                    {"label": value},
                    {"value": value},
                ):
                    try:
                        loc.select_option(**attempt, timeout=1500)
                        ok = True
                        break
                    except Exception:
                        continue
                if not ok:
                    for o in opts:
                        t = o.get("t", "") if isinstance(o, dict) else str(o)
                        if t and value.lower() in t.lower():
                            loc.select_option(label=t, timeout=1500)
                            picked = t
                            ok = True
                            break
                if not ok:
                    return False
                loc.evaluate(JS_DISPATCH_REACT_EVENTS)
                console.print(f"  [dim]  ✓ select [{key}] = {picked[:40]}[/dim]")
                return True
            except Exception as e:
                console.print(f"  [yellow]  ⚠ select {key} échoué : {str(e)[:60]}[/yellow]")
                return False

        # ── richtext / contenteditable (Workday, BambooHR…) ─────────────────
        if field.get("richtext") or ftype in ("richtext", "spinbutton"):
            try:
                try:
                    loc.scroll_into_view_if_needed(timeout=1500)
                except Exception:
                    pass
                loc.click(timeout=2000)
                time.sleep(0.25)
                # Sélectionne tout et remplace
                try:
                    page.keyboard.press("Control+a")
                    time.sleep(0.1)
                    page.keyboard.press("Meta+a")
                except Exception:
                    pass
                page.keyboard.type(value, delay=8)
                try:
                    loc.evaluate(JS_DISPATCH_REACT_EVENTS)
                except Exception:
                    pass
                short = value[:45].replace("\n", " ")
                console.print(f"  [dim]  ✓ richtext [{key}] = {short}[/dim]")
                return True
            except Exception as e:
                console.print(f"  [yellow]  ⚠ richtext {key} : {str(e)[:60]}[/yellow]")
                return False

        # ── Input / Textarea — retry plusieurs stratégies ───────────────────
        try:
            try:
                if loc.is_hidden(timeout=400):
                    return False
            except Exception:
                pass
            try:
                loc.scroll_into_view_if_needed(timeout=1500)
            except Exception:
                pass

            filled = False
            last_err = ""
            is_ashby = "ashbyhq.com" in (page.url or "")
            prefer_sequential = force_sequential or is_ashby

            def _verify_filled(target_loc) -> bool:
                try:
                    cur = (target_loc.input_value(timeout=500) or "").strip()
                    return bool(cur) and cur == str(value).strip()[: len(cur)]
                except Exception:
                    return False

            # Stratégie Ashby / retry : frappe caractère par caractère (React)
            if prefer_sequential and not filled:
                try:
                    loc.click(timeout=1500)
                    time.sleep(0.1)
                    try:
                        loc.fill("", timeout=600)
                    except Exception:
                        page.keyboard.press("Control+a")
                        page.keyboard.press("Delete")
                    loc.press_sequentially(str(value)[:300], delay=18)
                    loc.evaluate(JS_DISPATCH_REACT_EVENTS)
                    filled = _verify_filled(loc) or bool(str(value).strip())
                    if filled:
                        console.print("  [dim]  (Ashby/React : press_sequentially)[/dim]")
                except Exception as e:
                    last_err = str(e)[:80]

            # Stratégie 1 : fill() standard
            if not filled:
                try:
                    loc.click(timeout=1500)
                    time.sleep(0.08)
                    if ftag == "textarea" and len(value) > 200:
                        loc.fill("", timeout=800)
                        page.keyboard.type(value, delay=1)
                    else:
                        loc.fill(value, timeout=2500)
                    if is_ashby and not _verify_filled(loc):
                        raise RuntimeError("fill() sans effet React")
                    filled = True
                except Exception as e:
                    last_err = str(e)[:80]

            # Stratégie 2 : press_sequentially
            if not filled:
                try:
                    loc.click(timeout=1500)
                    time.sleep(0.1)
                    try:
                        loc.fill("", timeout=600)
                    except Exception:
                        page.keyboard.press("Control+a")
                        page.keyboard.press("Delete")
                    loc.press_sequentially(str(value)[:300], delay=12)
                    filled = True
                    console.print(f"  [dim]  (stratégie 2 : press_sequentially)[/dim]")
                except Exception as e:
                    last_err = str(e)[:80]

            # Stratégie 3 : JS direct
            if not filled:
                try:
                    loc.evaluate(f"""el => {{
                        el.focus();
                        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                            window.HTMLInputElement.prototype, 'value'
                        ) || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
                        if (nativeInputValueSetter) nativeInputValueSetter.set.call(el, {repr(value)});
                        else el.value = {repr(value)};
                        el.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        el.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}""")
                    filled = True
                    console.print(f"  [dim]  (stratégie 3 : JS natif)[/dim]")
                except Exception as e:
                    last_err = str(e)[:80]

            # Stratégie 4 : get_by_label (Ashby, labels visibles)
            if not filled:
                label_clean = re.sub(r"\*+$", "", (field.get("label") or "")).strip()
                if label_clean:
                    try:
                        lbl_loc = scope.get_by_label(
                            re.compile(re.escape(label_clean[:60]), re.I)
                        ).first
                        if lbl_loc.count() and lbl_loc.is_visible(timeout=600):
                            lbl_loc.click(timeout=1500)
                            lbl_loc.fill(str(value)[:300], timeout=2500)
                            lbl_loc.evaluate(JS_DISPATCH_REACT_EVENTS)
                            filled = True
                            loc = lbl_loc
                            console.print(f"  [dim]  (stratégie 4 : get_by_label « {label_clean[:30]} »)[/dim]")
                    except Exception as e:
                        last_err = str(e)[:80]

            if not filled:
                console.print(f"  [yellow]  ⚠ fill {key} : toutes les stratégies ont échoué — {last_err}[/yellow]")
                return False

            try:
                loc.evaluate(JS_DISPATCH_REACT_EVENTS)
            except Exception:
                pass
            time.sleep(0.1)

            short = str(value)[:45].replace("\n", " ")
            console.print(f"  [dim]  ✓ {key} = {short}[/dim]")
            return True
        except Exception as e:
            console.print(f"  [yellow]  ⚠ fill {key} échoué : {str(e)[:60]}[/yellow]")
            return False

    def _upload_cv_via_chooser(self, page, cv_path: Path,
                               scope=None, label_for: str = "") -> bool:
        """
        Upload le CV en simulant un clic sur le label/bouton qui ouvre le file chooser.
        Plus fiable que set_input_files direct pour les ATSes React (LinkedIn, Workday…).
        Retourne True si le fichier a été sélectionné via le chooser.
        """
        if not cv_path or not cv_path.exists():
            return False
        sc = scope or page
        candidates = []
        if label_for:
            candidates.append(f'label[for="{label_for}"]')
        candidates += LINKEDIN_CV_UPLOAD_TRIGGERS + [
            "label[for*='resume' i]",
            "label[for*='cv' i]",
            "label[for*='file' i]",
        ]
        for sel in candidates:
            try:
                trigger = sc.locator(sel).first
                if trigger.count() == 0:
                    continue
                if not trigger.is_visible(timeout=300):
                    continue
                with page.expect_file_chooser(timeout=4000) as fc_info:
                    trigger.click(timeout=2000)
                fc_info.value.set_files(str(cv_path))
                time.sleep(1.2)
                console.print(f"  [dim]  ✓ CV uploadé (file chooser) → {cv_path.name}[/dim]")
                return True
            except Exception:
                continue
        return False

    def smart_fill(self, job: Dict, cv_path, letter_text: str,
                   api_key: str, model: str = "claude-haiku-4-5-20251001",
                   app_dir: Optional[Path] = None,
                   auto_submit: bool = False,
                   pause: bool = True) -> bool:
        """
        Remplit intelligemment le formulaire :
        1. Ouvre l'URL
        2. Clique le bouton Postuler/Apply (sauf ATS inline)
        3. Pour chaque page : extrait les champs (incluant iframes + dialog),
           consulte le cache de réponses, appelle Claude pour les nouvelles questions,
           remplit, clique Suivant
        4. S'arrête avant Submit final (mode interactif) OU clique Submit + vérifie (auto_submit)
        5. Sauvegarde toutes les réponses dans <app_dir>/autofill_answers.json

        Si auto_submit=True : ne fait PAS de pause, clique le bouton Submit et
        vérifie qu'un message de confirmation s'affiche. Le résultat est exposé
        via self._auto_submit_confirmed (bool).
        """
        # Reset flag à chaque appel
        self._auto_submit_confirmed = False
        self._auto_submit_message = ""
        url = job.get("url", "")
        if not url:
            console.print("[red]  Pas d'URL[/red]")
            return False

        self._ensure_browser()
        # Mémorise les pages existantes avant d'en ouvrir de nouvelles
        # → permet de fermer les onglets créés si le fill échoue
        try:
            _pages_before_ids = {id(p) for p in self._browser.pages if not p.is_closed()}
        except Exception:
            _pages_before_ids = set()
        _fill_success = False

        page = self._browser.new_page()
        # Met l'onglet au premier plan pour que l'utilisateur voie ce qui se remplit
        try:
            page.bring_to_front()
        except Exception:
            pass
        ats  = detect_ats(url)

        console.print(f"\n  [bold]Ouverture[/bold] {url[:70]}")
        console.print(f"  Plateforme : [cyan]{ats}[/cyan]  |  Moteur : [bold green]Claude ({model})[/bold green]")

        # Charge le cache de réponses pour cette candidature + le bank cross-app
        app_answers_cache = _load_app_answers(app_dir)
        answer_bank = _load_answer_bank()
        if app_answers_cache:
            console.print(f"  [green]✓ Cache chargé : {len(app_answers_cache)} réponse(s) précédentes[/green]")
        if answer_bank:
            console.print(f"  [green]✓ Bank de réponses : {len(answer_bank)} entrée(s) génériques[/green]")
        sync_candidate_from_profile()
        console.print()

        all_filled: List[str] = []
        pages_recap: List[Dict] = []
        all_mapping_session: Dict[str, str] = {}  # accumulé sur toutes les pages
        all_fields_session: List[dict] = []

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=25_000)
            self._wait_settled(page, 2500, fast=(ats == "linkedin"))
            self._dismiss_cookies(page)
            self._dismiss_intermediate_popups(page)

            # ── LinkedIn : login + clic Postuler / Easy Apply ─────────────────
            if ats == "linkedin":
                page, ats = self._enter_from_linkedin_job(page, url, cv_path)
                if page is None:
                    return False

            # ── Autres ATS : clic Postuler si nécessaire ──────────────────────
            elif ats not in ATS_INLINE_FORM:
                _pb_other = {id(p) for p in self._browser.pages if not p.is_closed()}
                clicked, new_url = self._click_apply_button(page, ats)
                if clicked:
                    console.print(f"  [green]✓ Bouton d'application cliqué[/green]")
                    page = self._switch_to_latest_page(page, pages_before=_pb_other)
                    self._wait_settled(page, 4000)
                    self._dismiss_cookies(page)
                    self._dismiss_intermediate_popups(page)
                    new_ats = detect_ats_page(page)
                    if new_ats != "unknown":
                        ats = new_ats
                else:
                    console.print(
                        f"  [yellow]Pas de bouton d'application trouvé — "
                        f"on tente quand même d'inspecter la page[/yellow]"
                    )
                page, ats = self._ensure_application_form_ready(page, ats)

            else:
                page, ats = self._ensure_application_form_ready(page, ats)

            # ── Détection page "Créer un compte" → skip ───────────────────────
            needs_account = self._is_account_creation_page(page)
            if needs_account:
                console.print(f"\n  [bold red]⛔ Création de compte requise ({needs_account}) — skipped.[/bold red]")
                console.print(f"  [yellow]→ Cette offre nécessite un compte sur leur plateforme.")
                console.print(f"  [yellow]→ Postule manuellement via : {page.url[:80]}[/yellow]")
                # Marque dans job_info
                self._write_autofill_status(app_dir, skipped=True, skip_reason=f"account_creation:{needs_account}")
                return False

            # ── Boucle multi-pages ────────────────────────────────────────────
            MAX_STEPS = 12
            seen_field_signatures: set = set()
            tried_apply_click_on_step = set()  # steps où on a déjà retenté un clic Apply

            for step in range(MAX_STEPS):
                # Indicateur de progression
                indicator = self._get_step_indicator(page)
                hdr = f"  [bold cyan]── Page {step + 1}"
                if indicator:
                    hdr += f" (étape {indicator})"
                hdr += " ──[/bold cyan]"
                console.print(hdr)

                # Ferme toute popup intermédiaire qui aurait pu apparaître
                self._dismiss_intermediate_popups(page)

                # Scope : dialog (LinkedIn) ou page entière
                scope, scope_label = self._get_form_scope(page)

                # Scroll progressif (inutile dans la modale Easy Apply)
                if ats == "linkedin" and scope_label == "dialog":
                    pass
                else:
                    scroll_ms = 2200 if ats == "linkedin" else 5000
                    self._scroll_and_wait_form(page, max_wait_ms=scroll_ms)

                console.print(f"  [dim]Scope : {scope_label}[/dim]")

                if ats == "ashby":
                    if self._ensure_ashby_application_tab(page):
                        scope, scope_label = self._get_form_scope(page)
                        self._scroll_and_wait_form(page, max_wait_ms=3500)

                if ats == "linkedin" and scope_label == "dialog":
                    self._linkedin_easy_apply_progress(page, cv_path)
                    scope, scope_label = self._get_form_scope(page)

                if self._is_on_submit_page(scope) or self._is_on_submit_page(page):
                    lbl = self._submit_stop_message(scope) or self._submit_stop_message(page)
                    console.print(f"\n  [bold green]✅ « {lbl} » visible — arrêt avant soumission.[/bold green]")
                    pages_recap.append({"step": indicator, "filled": []})
                    break

                # Extraction (page + iframes — meilleure frame retenue)
                fill_scope, fields, used_frame, useful_count = self._probe_form_fields(page, scope)
                if useful_count > 0 and used_frame is not None:
                    console.print(
                        f"  [dim]→ champs dans iframe ({useful_count} utiles) : "
                        f"{used_frame.url[:60]}[/dim]"
                    )

                # Filtre les champs poubelle (chrome : search, language picker)
                useful_fields = [f for f in fields if not _is_junk_field(f)]
                usable = [
                    f for f in useful_fields
                    if f.get("id") or f.get("name") or (f.get("label") or "").strip()
                ]
                junk_count = len(fields) - len(useful_fields)
                msg = f"  {len(usable)} champ(s) utile(s) détecté(s)"
                if junk_count:
                    msg += f" [dim](+ {junk_count} ignoré(s))[/dim]"
                console.print(msg)

                # Si très peu de champs et qu'on n'a pas encore retenté un clic Apply,
                # essaie de cliquer Apply pour révéler le formulaire (ATS externes).
                if len(usable) < 2 and step not in tried_apply_click_on_step:
                    tried_apply_click_on_step.add(step)
                    console.print("  [yellow]→ Peu de champs, tentative de re-clic 'Apply'...[/yellow]")
                    _pb_retry = {id(p) for p in self._browser.pages if not p.is_closed()}
                    clicked_again, _ = self._click_apply_button(page, ats)
                    if not clicked_again and ats != "unknown":
                        clicked_again, _ = self._click_apply_button(page, "unknown")
                    if clicked_again:
                        page = self._switch_to_latest_page(page, pages_before=_pb_retry)
                        self._wait_settled(page, 4000)
                        self._dismiss_cookies(page)
                        self._dismiss_intermediate_popups(page)
                        new_ats = detect_ats_page(page)
                        if new_ats != "unknown":
                            ats = new_ats
                        # Re-extrait après le clic
                        self._scroll_and_wait_form(page, max_wait_ms=5000)
                        scope, scope_label = self._get_form_scope(page)
                        fill_scope, fields, used_frame, useful_count = self._probe_form_fields(page, scope)
                        useful_fields = [f for f in fields if not _is_junk_field(f)]
                        usable = [
                            f for f in useful_fields
                            if f.get("id") or f.get("name") or (f.get("label") or "").strip()
                        ]
                        console.print(f"  [green]Après re-clic : {len(usable)} champ(s) utile(s)[/green]")

                # Détecte une boucle (même set de champs que la page précédente)
                signature = tuple(sorted((f.get("id") or f.get("name") or "", f.get("type", "")) for f in usable))
                already_seen = signature in seen_field_signatures and signature
                if signature:
                    seen_field_signatures.add(signature)

                on_submit = self._is_on_submit_page(scope) or self._is_on_submit_page(page)

                if not usable:
                    if on_submit:
                        lbl = self._submit_stop_message(scope) or self._submit_stop_message(page)
                        console.print(f"\n  [bold green]✅ « {lbl} » visible — arrêt avant soumission.[/bold green]")
                        pages_recap.append({"step": indicator, "filled": []})
                        break

                    # ── Fallback : re-scroll + re-extraction avant de naviguer ──
                    if ats != "linkedin":
                        self._scroll_and_wait_form(page, max_wait_ms=3000)
                        scope2, scope_label2 = self._get_form_scope(page)
                        fill_scope2, fields2, _, uc2 = self._probe_form_fields(page, scope2)
                        useful2 = [f for f in fields2 if not _is_junk_field(f)]
                        usable2 = [f for f in useful2 if f.get("id") or f.get("name") or (f.get("label") or "").strip()]
                        if usable2:
                            console.print(f"  [green]→ Retry extraction : {len(usable2)} champ(s)[/green]")
                            usable = usable2
                            fill_scope = fill_scope2
                            scope = scope2
                            # Reprend le remplissage IA sur ces champs
                            mapping2: Dict[str, str] = _apply_profile_rules(usable)
                            for f in usable:
                                key2 = _field_key(f)
                                if not key2 or key2 in mapping2:
                                    continue
                                if key2 in app_answers_cache:
                                    mapping2[key2] = app_answers_cache[key2]
                                    continue
                                norm2 = _normalize_question(f.get("label") or "")
                                if norm2 and norm2 in answer_bank:
                                    mapping2[key2] = answer_bank[norm2]
                            remaining2 = [f for f in usable if _field_key(f) and _field_key(f) not in mapping2]
                            if remaining2:
                                try:
                                    ai2 = self._ai_map_fields(remaining2, api_key, model, letter_text, job=job)
                                    mapping2.update(ai2)
                                except Exception:
                                    pass
                            fb_by_key: Dict[str, dict] = {_field_key(f): f for f in usable if _field_key(f)}
                            for fk2, fv2 in mapping2.items():
                                fi2 = fb_by_key.get(fk2)
                                if fi2:
                                    try:
                                        self._fill_field(fill_scope, page, fi2, fv2, cv_path=cv_path, letter_text=letter_text)
                                    except Exception:
                                        pass
                            # continue vers la navigation normale

                    # ── Fallback vision IA si toujours 0 champ ────────────────
                    if not usable:
                        vision_action = None
                        if api_key:
                            vision_action = self._ai_visual_recover(page, api_key, step)

                        if vision_action == "STOP":
                            lbl = self._submit_stop_message(scope) or "Envoyer la candidature"
                            console.print(f"\n  [bold green]✅ Vision IA : « {lbl} » — arrêt avant soumission.[/bold green]")
                            pages_recap.append({"step": indicator, "filled": []})
                            break
                        if vision_action == "FILL_NEEDED":
                            console.print("  [yellow]→ Vision IA : champs requis détectés mais non extraits — on scroll et réessaie.[/yellow]")
                            self._scroll_and_wait_form(page, max_wait_ms=4000)
                            # Retente au prochain tour de boucle
                            continue
                        # vision_action == "CLICK_NEXT" ou UNKNOWN → tente Vérifier/Suivant
                        if vision_action is None:
                            # Ni API ni vision : on bascule en mode manuel immédiatement
                            console.print(
                                "\n  [bold yellow]⚠ BLOQUÉ (aucune API vision) — navigateur laissé ouvert.[/bold yellow]\n"
                                "  Remplissez manuellement dans Chromium puis appuyez [bold]Entrée[/bold],\n"
                                "  ou tapez [bold]stop[/bold] + Entrée pour abandonner.\n"
                            )
                            self._screenshot(page, f"blocked_no_api_step_{step+1}")
                            try:
                                usr = input("  > ").strip().lower()
                            except (EOFError, KeyboardInterrupt):
                                usr = "stop"
                            if usr == "stop":
                                break
                            self._wait_settled(page, 1500, fast=True)
                            continue

                    # Tente "Vérifier" puis "Suivant"
                    if self._click_review_button(scope) or self._click_review_button(page):
                        console.print("  [dim]→ bouton Vérifier cliqué[/dim]")
                        time.sleep(0.4)
                        self._dismiss_linkedin_save_draft_dialog(page)
                        continue
                    self._dismiss_linkedin_save_draft_dialog(page)
                    if self._click_next_button(scope, page=page) or self._click_next_button(page, page=page):
                        console.print("  [dim]→ bouton Suivant cliqué[/dim]")
                        continue
                    console.print("  [yellow]Aucun champ ni bouton de navigation — pause.[/yellow]")
                    self._screenshot(page, f"no_fields_step_{step+1}")
                    # WTTJ spontanée sans bouton/formulaire → signale pour suppression
                    is_wttj = ats == "wttj" or "welcometothejungle" in (page.url or "")
                    is_spontaneous = job.get("type") == "spontaneous"
                    if is_wttj and is_spontaneous and step <= 1:
                        self._no_spontaneous_form = True
                        console.print("  [red]⚠ Pas de formulaire de candidature spontanée — offre à supprimer.[/red]")
                        return False
                    break

                # Imprime un résumé des champs détectés (\\[ pour échapper le markup rich)
                for f in usable[:8]:
                    lbl = (f.get("label") or "").strip()[:50]
                    name = lbl or f.get('id') or f.get('name')
                    console.print(f"    [dim]·[/dim] \\[{f['tag']}:{f['type']}] {name}")
                if len(usable) > 8:
                    console.print(f"    [dim]· ... +{len(usable)-8} autres[/dim]")

                # ── Mapping : règles profil → cache → bank → Claude ─────────────
                mapping: Dict[str, str] = _apply_profile_rules(usable)
                from_rules = len(mapping)
                fields_for_claude = []
                from_cache = 0
                from_bank = 0
                for f in usable:
                    key = _field_key(f)
                    if not key:
                        continue
                    if key in mapping:
                        continue
                    # 1. Cache de la candidature (priorité haute)
                    if key in app_answers_cache:
                        mapping[key] = app_answers_cache[key]
                        from_cache += 1
                        continue
                    # 2. Bank cross-app par label normalisé
                    norm = _normalize_question(f.get("label") or "")
                    if norm and norm in answer_bank:
                        mapping[key] = answer_bank[norm]
                        from_bank += 1
                        continue
                    # 3. À envoyer à Claude
                    fields_for_claude.append(f)

                from_claude = 0
                if fields_for_claude:
                    console.print(f"  [dim]→ Claude analyse {len(fields_for_claude)} nouveau(x) champ(s)...[/dim]")
                    try:
                        ai_mapping = self._ai_map_fields(fields_for_claude, api_key, model,
                                                         letter_text, job=job)
                    except Exception as e:
                        console.print(f"  [red]Erreur Claude : {e}[/red]")
                        ai_mapping = {}
                    mapping.update(ai_mapping)
                    from_claude = len(ai_mapping)

                console.print(
                    f"  [dim]  {len(mapping)} mappés "
                    f"(rules:{from_rules} cache:{from_cache} bank:{from_bank} claude:{from_claude})[/dim]"
                )
                for k, v in list(mapping.items())[:6]:
                    sv = "__CV__" if v == "__CV_FILE__" else ("__LETTRE__" if v == "__COVER_LETTER__" else str(v)[:40])
                    console.print(f"    [dim]  {k} → {sv}[/dim]")

                # Mémorise pour le sauvegarde finale
                all_mapping_session.update(mapping)
                all_fields_session.extend(usable)

                fields_by_key: Dict[str, dict] = {}
                for f in usable:
                    fk = _field_key(f)
                    if fk and fk not in fields_by_key:
                        fields_by_key[fk] = f
                    # Aussi indexer par id et name standalone (au cas où Claude renvoie une clé partielle)
                    for k in (f.get("id"), f.get("name")):
                        if k and k not in fields_by_key:
                            fields_by_key[k] = f

                # Remplissage (chaque champ dans son try/except)
                filled_this_page = []
                failed_this_page = []
                for field_key, value in mapping.items():
                    fi = fields_by_key.get(field_key)
                    if not fi:
                        continue
                    try:
                        if self._fill_field(fill_scope, page, fi, value,
                                             cv_path=cv_path, letter_text=letter_text):
                            filled_this_page.append(field_key)
                            time.sleep(0.12 if ats == "linkedin" else 0.2)
                        else:
                            failed_this_page.append(field_key)
                    except Exception as e:
                        console.print(f"  [yellow]  ⚠ exception sur {field_key} : {str(e)[:60]}[/yellow]")
                        failed_this_page.append(field_key)
                        continue

                # 2e passe : champs identité ratés (Ashby React, labels sans id)
                if failed_this_page:
                    retry_keys = [k for k in failed_this_page if k in mapping]
                    for field_key in retry_keys:
                        fi = fields_by_key.get(field_key)
                        if not fi:
                            continue
                        val = mapping.get(field_key)
                        if not val:
                            continue
                        try:
                            if self._fill_field(
                                fill_scope, page, fi, val,
                                cv_path=cv_path, letter_text=letter_text,
                                force_sequential=True,
                            ):
                                filled_this_page.append(field_key)
                                failed_this_page.remove(field_key)
                                time.sleep(0.15)
                        except Exception:
                            pass

                # Fallback CV : si un CV est dispo et qu'aucun file input n'a été
                # rempli via le mapping, on upload sur le premier input[type=file]
                # accepting pdf (utile pour Bolt et autres pages avec file input
                # sans id/name visible)
                cv_was_filled = any(
                    fields_by_key.get(k, {}).get("type") == "file"
                    for k in filled_this_page
                ) or any(
                    mapping.get(k) == "__CV_FILE__"
                    for k in filled_this_page
                )
                if cv_path and not cv_was_filled and Path(cv_path).exists():
                    cv_p = Path(cv_path)
                    if ats == "linkedin":
                        scope_li, _ = self._get_form_scope(page)
                        if self._linkedin_upload_generated_cv(scope_li, page, cv_p):
                            filled_this_page.append("__cv_linkedin__")
                            cv_was_filled = True
                    if not cv_was_filled:
                        try:
                            for sel in [
                                "input[type='file'][accept*='pdf' i]",
                                "input[type='file'][name*='resume' i]",
                                "input[type='file'][name*='cv' i]",
                                "input[type='file'][id*='resume' i]",
                                "input[type='file']",
                            ]:
                                target = (used_frame or page).locator(sel).first
                                if target.count() > 0:
                                    target.set_input_files(str(cv_path), timeout=4000)
                                    console.print(f"  [dim]  ✓ CV uploadé (fallback) → {Path(cv_path).name} via '{sel[:35]}'[/dim]")
                                    filled_this_page.append("__cv_fallback__")
                                    break
                        except Exception as e:
                            console.print(f"  [yellow]  ⚠ fallback CV : {str(e)[:60]}[/yellow]")

                all_filled.extend(filled_this_page)
                pages_recap.append({"step": indicator, "filled": filled_this_page, "failed": failed_this_page})

                console.print(f"  [green]✓ {len(filled_this_page)} rempli(s)[/green]"
                              + (f" [red]| {len(failed_this_page)} raté(s)[/red]" if failed_this_page else ""))

                # On est maintenant sur Submit ?
                if self._is_on_submit_page(scope) or self._is_on_submit_page(page):
                    lbl = self._submit_stop_message(scope) or self._submit_stop_message(page)
                    console.print(f"\n  [bold green]✅ « {lbl} » visible — arrêt avant soumission.[/bold green]")
                    break

                # Sinon, on essaie Vérifier puis Suivant (jamais Envoyer/Soumettre)
                advanced = False
                if ats == "linkedin":
                    scope_li, _ = self._get_form_scope(page)
                    self._fill_linkedin_city_fields(scope_li, page)
                    if cv_path and Path(cv_path).exists():
                        if self._linkedin_is_resume_step(scope_li) or self._linkedin_has_visible_cv_upload(scope_li):
                            self._linkedin_upload_generated_cv(scope_li, page, Path(cv_path))
                    self._dismiss_linkedin_save_draft_dialog(page)
                    time.sleep(0.2)

                can_advance = True
                if ats == "linkedin":
                    scope_li, _ = self._get_form_scope(page)
                    if self._linkedin_has_blocking_empty_fields(scope_li):
                        can_advance = False
                        console.print(
                            "  [yellow]→ LinkedIn : champs requis vides — pas de Suivant[/yellow]"
                        )
                elif len(usable) >= 1 and len(filled_this_page) == 0 and len(mapping) >= 1:
                    can_advance = False
                    console.print(
                        f"  [yellow]→ {len(usable)} champ(s) détecté(s), 0 rempli — pas de Suivant[/yellow]"
                    )

                if can_advance:
                    if self._click_review_button(scope) or self._click_review_button(page):
                        console.print("  [dim]→ Vérifier cliqué[/dim]")
                        self._wait_settled(page, 1500, fast=(ats == "linkedin"))
                        self._dismiss_cookies(page)
                        advanced = True
                    elif self._click_next_button(scope, page=page) or self._click_next_button(page, page=page):
                        console.print("  [dim]→ Suivant cliqué[/dim]")
                        self._dismiss_cookies(page)
                        advanced = True

                if not advanced:
                    # Fallback vision IA : peut-être un bouton non standard
                    if api_key:
                        vision_nav = self._ai_visual_recover(page, api_key, step)
                        if vision_nav == "CLICK_NEXT":
                            # Re-tente avec plus de sélecteurs
                            self._dismiss_linkedin_save_draft_dialog(page)
                            if self._click_next_button(scope, page=page) or self._click_next_button(page, page=page):
                                console.print("  [dim]→ Vision IA → Suivant cliqué[/dim]")
                                advanced = True
                        elif vision_nav == "STOP":
                            lbl2 = self._submit_stop_message(scope) or "Envoyer la candidature"
                            console.print(f"\n  [bold green]✅ Vision IA : « {lbl2} » — arrêt.[/bold green]")
                            break
                    if not advanced:
                        # ── Mode reprise manuelle ─────────────────────────────
                        # Le navigateur reste ouvert et visible.
                        # L'utilisateur peut remplir/cliquer manuellement,
                        # puis appuyer sur Entrée dans le terminal pour reprendre.
                        console.print(
                            "\n  [bold yellow]⚠ BLOQUÉ — navigateur laissé ouvert.[/bold yellow]\n"
                            "  Remplissez / cliquez manuellement dans Chromium,\n"
                            "  puis appuyez sur [bold]Entrée[/bold] dans ce terminal pour continuer,\n"
                            "  ou tapez [bold]stop[/bold] + Entrée pour abandonner cette candidature.\n"
                        )
                        self._screenshot(page, f"blocked_step_{step+1}")
                        try:
                            user_input = input("  > ").strip().lower()
                        except (EOFError, KeyboardInterrupt):
                            user_input = "stop"
                        if user_input == "stop":
                            console.print("  [red]Candidature abandonnée à la demande.[/red]")
                            break
                        # L'utilisateur a appuyé Entrée — on re-sonde la page
                        console.print("  [dim]→ Reprise après intervention manuelle…[/dim]")
                        self._wait_settled(page, 1500, fast=True)
                        self._dismiss_linkedin_save_draft_dialog(page)
                        # On repart au prochain tour de boucle sans incrémenter step
                        continue

                if already_seen and step > 0:
                    console.print("  [yellow]⚠ Mêmes champs que page précédente — boucle détectée, on s'arrête.[/yellow]")
                    self._screenshot(page, f"loop_step_{step+1}")
                    break

            # ── Résumé structuré de la candidature ───────────────────────────
            total_filled = sum(len(r.get("filled", [])) for r in pages_recap)
            total_failed = sum(len(r.get("failed", [])) for r in pages_recap)
            steps_done   = len(pages_recap)
            console.rule(f"[bold]Résumé candidature — ATS : {ats}[/bold]")
            console.print(f"  Étapes : {steps_done}  |  Champs remplis : {total_filled}  |  Échecs : {total_failed}")
            for i, recap in enumerate(pages_recap, 1):
                ok_n  = len(recap.get("filled", []))
                ko_n  = len(recap.get("failed", []))
                step_lbl = recap.get("step") or f"étape {i}"
                status = "[green]✓[/green]" if ko_n == 0 else "[yellow]⚠[/yellow]"
                detail = ""
                if recap.get("failed"):
                    detail = "  échoués : " + ", ".join(str(k)[:30] for k in recap["failed"][:5])
                console.print(f"  {status} {step_lbl} — {ok_n} ok / {ko_n} ko{detail}")
            console.rule()

            # ── Sauvegarde des réponses ───────────────────────────────────────
            if app_dir and all_mapping_session:
                _save_app_answers(app_dir, job, all_mapping_session, all_fields_session)
                console.print(f"  [green]💾 Réponses sauvegardées → {app_dir.name}/{APP_ANSWERS_FILE}[/green]")

            # Met à jour le bank cross-app (questions génériques uniquement)
            if all_mapping_session and all_fields_session:
                self._update_answer_bank(answer_bank, all_mapping_session, all_fields_session, job)

            # ── Soumission automatique (clic Submit + vérification) ───────────
            if auto_submit:
                ok = self._auto_submit_and_verify(page, app_dir=app_dir)
                self._auto_submit_confirmed = ok
                if ok:
                    self._write_autofill_status(app_dir, fields_filled=len(all_filled), submitted=True)
                _fill_success = ok
                return ok

            # ── Statut autofill dans job_info.json ────────────────────────────
            self._write_autofill_status(app_dir, fields_filled=len(all_filled))

            # ── Pause finale (skippable en mode batch) ────────────────────────
            if pause:
                self._pause_for_review(page, all_filled, pages_recap)
            else:
                console.print(
                    f"  [green]✓ Formulaire prêt, clique « Envoyer la candidature » dans l'onglet[/green]"
                )
            _fill_success = True
            return True

        except Exception as e:
            import traceback
            console.print(f"  [red]Erreur smart_fill : {e}[/red]")
            console.print(f"[dim]{traceback.format_exc()}[/dim]")
            self._screenshot(page, "smart_fill_error")
            # Sauvegarde quand même ce qu'on a déjà mappé
            if app_dir and all_mapping_session:
                try:
                    _save_app_answers(app_dir, job, all_mapping_session, all_fields_session)
                    console.print(f"  [green]💾 Cache partiel sauvegardé[/green]")
                except Exception:
                    pass
            return False

        finally:
            # Si le fill a échoué, ferme tous les onglets ouverts pendant cet appel
            # pour éviter l'accumulation de tabs morts qui ralentissent le navigateur.
            if not _fill_success:
                try:
                    for p in list(self._browser.pages):
                        try:
                            if not p.is_closed() and id(p) not in _pages_before_ids:
                                p.close()
                        except Exception:
                            pass
                except Exception:
                    pass

    def _is_account_creation_page(self, page) -> Optional[str]:
        """
        Détecte si la page courante demande de créer un compte (et non de postuler).
        Retourne la raison si détecté, None sinon.
        """
        try:
            return page.evaluate("""() => {
                const body = (document.body ? document.body.innerText : '').toLowerCase();
                // 2 champs password = inscription
                const pws = document.querySelectorAll('input[type="password"]');
                if (pws.length >= 2) return 'double_password_field';
                // Champ "confirm password"
                const confirms = document.querySelectorAll(
                    'input[name*="confirm" i][type="password"],' +
                    'input[id*="confirm" i][type="password"],' +
                    'input[placeholder*="confirm" i][type="password"],' +
                    'input[aria-label*="confirm" i][type="password"]'
                );
                if (confirms.length > 0) return 'confirm_password_field';
                // Textes caractéristiques d'une inscription
                const patterns = [
                    'create an account', 'créer un compte', 'creer un compte',
                    'sign up to apply', 'register to apply', 'create account to apply',
                    'inscrivez-vous pour postuler', 'create your account',
                    'already have an account', 'already have an account? log in',
                    'vous avez déjà un compte', 'vous avez deja un compte',
                ];
                for (const p of patterns) {
                    if (body.includes(p)) return p.replace(/ /g, '_').substring(0, 40);
                }
                return null;
            }""")
        except Exception:
            return None

    def _write_autofill_status(self, app_dir: Optional[Path],
                                fields_filled: int = 0,
                                skipped: bool = False,
                                skip_reason: str = "",
                                submitted: bool = False):
        """Écrit le statut autofill dans job_info.json pour affichage dashboard."""
        if not app_dir:
            return
        try:
            from datetime import datetime as _dt
            info_path = app_dir / "job_info.json"
            info: dict = {}
            if info_path.exists():
                try:
                    info = json.loads(info_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            info["autofill"] = {
                "done":          not skipped,
                "at":            _dt.now().strftime("%Y-%m-%dT%H:%M"),
                "fields_filled": fields_filled,
                "skipped":       skipped,
                "skip_reason":   skip_reason,
                "submitted":     submitted,
            }
            info_path.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            console.print(f"  [dim]autofill status non sauvegardé : {e}[/dim]")

    def __del__(self):
        self._close()
