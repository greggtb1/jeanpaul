"""
Profil candidat pour la génération CV / lettres — chargé depuis Supabase
(profil onboarding + texte extrait du CV PDF uploadé).
"""
import os
import re
import io
from io import BytesIO
from typing import Any, Dict, Optional
from urllib.request import urlopen

from profile import PROFILE as DEFAULT_PROFILE

_TONE_HINTS = {
    "pro": "Professionnel et posé, classique, rassurant.",
    "corporate": "Formelle et corporate, structure de lettre classique.",
    "direct": "Formelle et corporate, structure de lettre classique.",  # legacy
    "enthousiaste": "Enthousiaste et énergique, motivé sans en faire trop.",
    "story": "Personnel et narratif, accroche qui raconte le parcours.",
    "concis": "Ultra-court et percutant, 3 phrases max, impact immédiat.",
}

_TONE_BLOCKS = {
    "pro": """TON DEMANDÉ : Professionnel & posé (PRIORITÉ ÉLEVÉE — la lettre doit clairement sonner ainsi)

Applique ce ton sur toute la lettre :
- Phrases équilibrées, vocabulaire soigné, crédible sans jargon RH
- Registre classique : poli, assuré, jamais familier ni distant
- Rythme posé : une idée par phrase, transitions nettes entre paragraphes
- Éviter : tournures startup, humour, familiarité, emphase excessive

Référence de rythme (adapter au candidat et à l'offre, ne pas recopier) :
« Mon expérience en pilotage opérationnel m'a appris à tenir la cadence quand le volume augmente. Ce que je lis dans votre offre, c'est le même enjeu : structurer ce qui scale déjà. »""",

    "corporate": """TON DEMANDÉ : Formelle & corporate (PRIORITÉ ÉLEVÉE — lettre administrative classique)

Applique ce ton et cette STRUCTURE sur toute la lettre :
- Registre soutenu, poli, corporate : « vous », formulations soignées, zéro familiarité
- Phrases claires, un peu plus longues qu'un message LinkedIn, sans jargon startup
- PAS de ton « direct / percutant » : c'est une vraie lettre de motivation formelle

STRUCTURE OBLIGATOIRE (texte prêt à copier-coller, avec sauts de ligne) :
1) Ligne lieu + date (ex. « Paris, le 19 juillet 2026 »)
2) Ligne vide
3) Formule d'appel : « Madame, Monsieur, » (ou équivalent adapté si le destinataire est connu)
4) Ligne vide
5) Objet sur une ligne : « Objet : Candidature au poste de [intitulé] — [entreprise] »
6) Ligne vide
7) 2 à 3 paragraphes de corps (compétences, lien avec le poste, motivation factuelle)
8) Ligne vide
9) Formule de politesse formelle, ex. « Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées. »
10) Ligne vide
11) Signature : prénom et nom du candidat seuls

Référence de rythme (adapter, ne pas recopier) :
« Au cours des dernières années, j'ai eu l'occasion de piloter des opérations B2B de bout en bout, dans un contexte exigeant en termes de volume et de fiabilité. Cette expérience m'a permis de développer une approche structurée, centrée sur la qualité d'exécution.

Votre offre de [poste] chez [entreprise] correspond pleinement à ce cadre. Les enjeux que vous décrivez rejoignent les situations que j'ai déjà eu à traiter. »

Inclure lieu/date, objet, appel, politesse et signature DANS le texte retourné.""",

    "enthousiaste": """TON DEMANDÉ : Enthousiaste & énergique (PRIORITÉ ÉLEVÉE — la lettre doit clairement sonner ainsi)

Applique ce ton sur toute la lettre :
- Verbes actifs, énergie visible dans le choix des mots
- Montrer l'envie par des faits et des connexions concrètes, pas par des superlatifs
- Éviter absolument : "passionné par", "thrilled", "excited to", "opportunité unique"
- L'enthousiasme vient du contenu (pourquoi CE poste, CETTE entreprise), pas du ton forcé

Référence de rythme (adapter au candidat et à l'offre, ne pas recopier) :
« Ce qui m'accroche dans votre offre, c'est le mix ops + produit sur un marché qui accélère. J'ai déjà tenu ce type de rôle en solo : croissance, partenaires, exécution. C'est le genre de défi où je suis utile dès le premier mois. »""",

    "story": """TON DEMANDÉ : Personnel & narratif (PRIORITÉ ÉLEVÉE — la lettre doit clairement sonner ainsi)

Applique ce ton sur toute la lettre :
- Ouvrir sur une situation, un moment ou une scène concrète du parcours du candidat
- Fil narratif léger : situation → apprentissage → lien avec le poste
- Voix à la première personne, vivante, pas un résumé de CV
- Éviter : listes de compétences, ton administratif, accroche générique

Référence de rythme (adapter au candidat et à l'offre, ne pas recopier) :
« Il y a deux ans, on passait de 5 à 30 partenaires en trois mois. C'est là que j'ai compris que les ops ne se délèguent pas : soit les process tiennent, soit tout casse. Votre poste, c'est la même équation à plus grande échelle. »""",

    "concis": """TON DEMANDÉ : Ultra-court & percutant (PRIORITÉ ÉLEVÉE — la lettre doit clairement sonner ainsi)

Applique ce ton sur toute la lettre :
- MAXIMUM 3 phrases. 80 à 100 mots total. Pas de paragraphes multiples.
- Une phrase = une info forte. Zéro connecteur inutile.
- Impact immédiat : qui je suis (en une ligne) → pourquoi ce poste → ouverture
- Si le ton concis entre en conflit avec la longueur standard, le ton concis gagne

Référence de rythme (adapter au candidat et à l'offre, ne pas recopier) :
« Ops B2B en solo, 850k€ CA, 30 partenaires. Votre poste cherche quelqu'un qui a déjà tenu ce type de cockpit. Disponible pour en parler cette semaine. »""",
}

_TONE_HINTS_EN = {
    "pro": "Professional and composed, classic, reassuring.",
    "corporate": "Formal corporate letter, classic layout and phrasing.",
    "direct": "Formal corporate letter, classic layout and phrasing.",  # legacy
    "enthousiaste": "Enthusiastic and energetic, motivated without overdoing it.",
    "story": "Personal and narrative, opening that tells the career story.",
    "concis": "Ultra-short and punchy, 3 sentences max, immediate impact.",
}

_TONE_BLOCKS_EN = {
    "pro": """REQUESTED TONE: Professional & composed (HIGH PRIORITY — the letter must clearly sound like this)

Apply this tone throughout:
- Balanced sentences, polished vocabulary, credible without HR jargon
- Classic register: polite, confident, never casual or distant
- Steady rhythm: one idea per sentence, clean transitions between paragraphs
- Avoid: startup slang, humor, excessive familiarity, over-the-top enthusiasm

Rhythm reference (adapt to candidate and role, do not copy):
"My experience running operations taught me to keep pace when volume spikes. What I read in your posting is the same challenge: structuring what's already scaling.""",

    "corporate": """REQUESTED TONE: Formal & corporate (HIGH PRIORITY — classic business letter)

Apply this tone and STRUCTURE throughout:
- Formal register, polite, corporate: polished phrasing, no casual tone
- Clear sentences, slightly longer than a LinkedIn note, no startup slang
- NOT a punchy "direct" message: a proper formal cover letter

REQUIRED STRUCTURE (copy-paste ready, with blank lines):
1) City + date line (e.g. "Paris, 19 July 2026")
2) Blank line
3) Salutation: "Dear Hiring Manager," (or a named contact if known)
4) Blank line
5) Subject line: "Re: Application for [title] — [company]"
6) Blank line
7) 2 to 3 body paragraphs (skills, fit, factual motivation)
8) Blank line
9) Formal closing, e.g. "Yours sincerely,"
10) Blank line
11) Signature: candidate first and last name only

Include city/date, subject, salutation, closing and signature IN the returned text.""",

    "enthousiaste": """REQUESTED TONE: Enthusiastic & energetic (HIGH PRIORITY — the letter must clearly sound like this)

Apply this tone throughout:
- Active verbs, visible energy in word choice
- Show interest through facts and concrete connections, not superlatives
- Absolutely avoid: "passionate about", "thrilled", "excited to", "unique opportunity"
- Enthusiasm comes from content (why THIS role, THIS company), not forced tone

Rhythm reference (adapt to candidate and role, do not copy):
"What pulls me in your posting is the ops + product mix on a market that's accelerating. I've already held this kind of role solo: growth, partners, execution. That's where I'm useful from month one.""",

    "story": """REQUESTED TONE: Personal & narrative (HIGH PRIORITY — the letter must clearly sound like this)

Apply this tone throughout:
- Open on a situation, moment, or concrete scene from the candidate's path
- Light narrative thread: situation → lesson → link to the role
- First-person voice, alive, not a CV summary
- Avoid: skill lists, administrative tone, generic hooks

Rhythm reference (adapt to candidate and role, do not copy):
"Two years ago we went from 5 to 30 partners in three months. That's when I learned ops don't delegate themselves: either processes hold, or everything breaks. Your role is the same equation at a larger scale.""",

    "concis": """REQUESTED TONE: Ultra-short & punchy (HIGH PRIORITY — the letter must clearly sound like this)

Apply this tone throughout:
- MAXIMUM 3 sentences. 80 to 100 words total. No multiple paragraphs.
- One sentence = one strong point. Zero unnecessary connectors.
- Immediate impact: who I am (one line) → why this role → opening
- If concise tone conflicts with standard length, concise tone wins

Rhythm reference (adapt to candidate and role, do not copy):
"Solo B2B ops, €850k revenue, 30 partners. Your role needs someone who's already held this kind of cockpit. Available to talk this week.""",
}


def normalize_letter_tone(tone_id: Optional[str]) -> str:
    t = (tone_id or "pro").strip() or "pro"
    if t == "direct":
        return "corporate"
    return t


def tone_hint_for(tone_id: str, lang: str = "fr") -> str:
    hints = _TONE_HINTS_EN if lang == "en" else _TONE_HINTS
    return hints.get(normalize_letter_tone(tone_id), hints["pro"])


def tone_block_for_letter(tone_id: str, lang: str = "fr") -> str:
    blocks = _TONE_BLOCKS_EN if lang == "en" else _TONE_BLOCKS
    return blocks.get(normalize_letter_tone(tone_id), blocks["pro"])

_cache: Optional[Dict[str, Any]] = None


def _storage_path_from_public_url(url: str) -> Optional[str]:
    for marker in ("/storage/v1/object/public/cvs/", "/storage/v1/object/sign/cvs/"):
        if marker in url:
            return url.split(marker, 1)[1].split("?")[0]
    return None


def _pdf_bytes_to_text(data: bytes) -> str:
    try:
        import logging
        from contextlib import redirect_stderr
        from pypdf import PdfReader

        # Certains PDF (CV Word/LibreOffice) ont une xref cassée : pypdf loggue
        # "Ignoring wrong pointing object…" sans bloquer l'extraction.
        logging.getLogger("pypdf").setLevel(logging.ERROR)
        with redirect_stderr(io.StringIO()):
            reader = PdfReader(BytesIO(data), strict=False)
            parts = []
            for page in reader.pages[:12]:
                t = page.extract_text() or ""
                if t.strip():
                    parts.append(t)
        return "\n".join(parts).strip()
    except Exception:
        return ""


def _extract_pdf_text(url: str) -> str:
    if not url:
        return ""

    data: Optional[bytes] = None
    try:
        with urlopen(url, timeout=45) as resp:
            data = resp.read()
    except Exception:
        data = None

    if not data:
        path = _storage_path_from_public_url(url)
        if path:
            try:
                from store import client

                data = client().storage.from_("cvs").download(path)
            except Exception:
                pass

    if not data:
        return ""
    return _pdf_bytes_to_text(data)


def _extract_pdf_text_from_storage_path(path: str) -> str:
    if not path:
        return ""
    try:
        from store import client

        data = client().storage.from_("cvs").download(path)
    except Exception:
        data = None
    return _pdf_bytes_to_text(data) if data else ""


def _empty_user_structured() -> Dict[str, Any]:
    return {
        "experience": [],
        "skills": [],
        "tools": {"dev": [], "automation": [], "growth": []},
        "education": {},
        "languages": {},
        "website": "",
        "motivation_hook": "",
    }


_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}")
_PHONE_RE = re.compile(r"(?:\+33\s?[1-9]|0[1-9])(?:[\s.\-]?\d{2}){4}")
_NAME_STOP_WORDS = {
    "apply", "aiapply", "job", "jobs", "jobapply", "cv", "resume", "résumé", "curriculum",
    "vitae", "profile", "profil", "contact", "candidat", "candidature", "linkedin",
    "jean", "paul", "email", "mail", "phone", "tel", "mobile", "address", "adresse",
    "experience", "expérience", "compétences", "competences", "skills", "summary",
    "about", "portfolio", "www", "http", "https", "generated", "powered",
    "application", "for", "company", "pour", "entreprise", "lettre", "motivation",
    "cover", "letter", "role", "poste",
}

_JOB_TITLE_WORDS = {
    "lead", "manager", "management", "operations", "operation", "customer", "success",
    "officer", "engineer", "engineering", "developer", "developpeur", "director",
    "directeur", "directrice", "head", "senior", "junior", "intern", "internship",
    "stagiaire", "alternant", "alternance", "specialist", "specialiste", "consultant",
    "consultante", "analyst", "analyste", "coordinator", "coordinateur", "coordinatrice",
    "associate", "executive", "assistant", "assistante", "responsable", "charge",
    "chargee", "ingenieur", "ingenieure", "product", "project", "projet", "marketing",
    "sales", "account", "growth", "designer", "design", "data", "software", "fullstack",
    "frontend", "backend", "devops", "recruiter", "recruteur", "hr", "rh", "finance",
    "chef", "cheffe", "owner", "scientist", "technicien", "technicienne", "support",
    "commercial", "commerciale", "partnerships", "partnership", "partenariats",
    "partenariat", "strategic", "strategique", "strategy", "strategie", "founder",
    "fondateur", "fondatrice", "ceo", "cto", "cfo", "coo", "vp", "cdi", "cdd",
    "freelance", "indépendant", "independant",
}

_NAME_JUNK_PHRASES = (
    "application for company",
    "application for",
    "candidature pour entreprise",
    "candidature pour",
)


def is_plausible_person_name(name: Optional[str]) -> bool:
    """Nom de personne réel — pas un label de template CV ni un intitulé de poste."""
    raw = (name or "").strip()
    if not raw:
        return False
    # Bannière offre / ligne mélangée
    if "·" in raw or "|" in raw or re.search(r"\s[-–—]\s", raw):
        return False
    cleaned = re.sub(r"\s+", " ", raw)
    if len(cleaned) < 4 or len(cleaned) > 55:
        return False
    lower = cleaned.lower()
    if lower in {"candidat", "candidate"}:
        return False
    if any(phrase in lower for phrase in _NAME_JUNK_PHRASES):
        return False
    words = cleaned.split()
    if len(words) < 2 or len(words) > 4:
        return False
    if not all(re.match(r"^[A-Za-zÀ-ÿ'’-]+$", w) for w in words):
        return False
    lower_words = [w.lower() for w in words]
    if any(w in _JOB_TITLE_WORDS for w in lower_words):
        return False
    junk_count = sum(1 for w in lower_words if w in _NAME_STOP_WORDS)
    if junk_count >= 2:
        return False
    if any(w in _NAME_STOP_WORDS for w in lower_words):
        if junk_count >= 1 and len(words) <= 3 and junk_count == len(words):
            return False
    return True


def sanitize_person_name(*candidates: Optional[str]) -> str:
    for raw in candidates:
        cleaned = re.sub(r"\s+", " ", (raw or "").strip())
        if is_plausible_person_name(cleaned):
            return cleaned
    return ""


def _looks_like_name_line(line: str) -> bool:
    return is_plausible_person_name(line)

def _collect_emails(text: str) -> list:
    seen = set()
    out = []
    for m in _EMAIL_RE.finditer(text or ""):
        em = m.group(0)
        key = em.lower()
        if key not in seen:
            seen.add(key)
            out.append(em)
    return out


def _email_matches_name(email: str, name: str) -> bool:
    if not email or not name:
        return False
    local = re.sub(r"[._+\-]", " ", email.split("@", 1)[0].lower())
    parts = [p.lower() for p in name.split() if len(p) >= 3 and p.lower() not in _NAME_STOP_WORDS]
    if not parts:
        return False
    return any(part in local for part in parts)


def _pick_email_for_name(emails: list, name: str) -> str:
    if not emails or not name:
        return ""
    parts = [p.lower() for p in name.split() if len(p) >= 3 and p.lower() not in _NAME_STOP_WORDS]
    if not parts:
        return ""
    best = ""
    best_score = 0
    for em in emails:
        local = re.sub(r"[._+\-]", " ", em.split("@", 1)[0].lower())
        score = sum(2 for part in parts if part in local)
        if score > best_score:
            best_score = score
            best = em
    return best if best_score > 0 else ""


def _name_from_cv_filename(filename: str) -> str:
    base = re.sub(r"\.pdf$", "", (filename or "").strip(), flags=re.I)
    tokens = re.split(r"[_\-\s]+", base)
    words = []
    stop_job = {"cdi", "cdd", "stage", "alternance", "dev", "fullstack", "saas", "cv", "resume"}
    for token in tokens:
        if not token or not re.match(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]*$", token):
            break
        if token.lower() in _NAME_STOP_WORDS or token.lower() in stop_job:
            break
        words.append(token[0].upper() + token[1:].lower())
        if len(words) >= 4:
            break
    return " ".join(words) if len(words) >= 2 else ""


def _parse_identity_from_cv_text(cv_text: str, filename: str = "") -> Dict[str, str]:
    """Extrait nom / email / téléphone du CV uploadé."""
    if not (cv_text or "").strip():
        return {"name": "", "email": "", "phone": ""}

    lines = [ln.strip() for ln in cv_text.split("\n") if ln.strip()]
    joined = " ".join(lines)
    emails = _collect_emails(joined)
    phone_match = _PHONE_RE.search(joined)
    phone = re.sub(r"\s+", " ", phone_match.group(0)).strip() if phone_match else ""

    name = ""
    for line in lines[:15]:
        if "·" in line or "|" in line or re.search(r"\s[-–—]\s", line):
            continue
        if re.search(r"\b(cdi|cdd|stage|alternance|remote)\b", line, re.I):
            continue
        if _looks_like_name_line(line):
            name = re.sub(r"\s+", " ", line.strip())
            break

    if not name and emails:
        local = emails[0].split("@", 1)[0].lower()
        for line in lines[:25]:
            line_lower = line.lower()
            if emails[0].lower() not in line_lower and local not in line_lower:
                continue
            candidate = _EMAIL_RE.sub(" ", line)
            candidate = re.sub(r"[|·•,/;()\[\]{}<>@]", " ", candidate)
            candidate = re.sub(r"\s+", " ", candidate).strip()
            if _looks_like_name_line(candidate):
                name = candidate
                break

    if not name and filename:
        name = _name_from_cv_filename(filename)

    email = _pick_email_for_name(emails, name)

    return {"name": name, "email": email, "phone": phone}


def load_user_profile(force: bool = False) -> Dict[str, Any]:
    """Retourne le profil actif (Supabase + CV uploadé) ou le profil par défaut CLI."""
    global _cache
    if _cache is not None and not force:
        return _cache

    uid = os.environ.get("JA_USER_ID")
    if not uid:
        _cache = {**DEFAULT_PROFILE, "_source": "default", "_has_uploaded_cv": False}
        return _cache

    try:
        from store import client

        res = client().table("profiles").select("*").eq("id", uid).maybe_single().execute()
        p = res.data or {}
    except Exception:
        p = {}

    summary = (p.get("summary") or "").strip()
    roles = p.get("target_roles") or []
    locs = p.get("target_locations") or []
    has_profile_data = bool(
        p.get("full_name")
        or p.get("cv_url")
        or roles
        or locs
        or summary
    )

    if not has_profile_data:
        # Compte sans critères ni CV : base vide (jamais le profil CLI par défaut).
        _cache = {
            **_empty_user_structured(),
            "name": "",
            "email": "",
            "phone": "",
            "_source": "user",
            "_has_uploaded_cv": False,
            "_uid": uid,
            "_account_email": (p.get("email") or "").strip(),
            "_account_name": (p.get("full_name") or "").strip(),
            "_account_phone": (p.get("phone") or "").strip(),
        }
        return _cache

    cv_url = (p.get("cv_url") or "").strip()
    cv_path = (p.get("cv_path") or "").strip()
    cv_filename = (p.get("cv_filename") or "").strip()
    cv_text = _extract_pdf_text(cv_url) if cv_url else ""
    if not cv_text and cv_path:
        cv_text = _extract_pdf_text_from_storage_path(cv_path)
    cv_identity = (
        _parse_identity_from_cv_text(cv_text, cv_filename) if cv_text.strip() else {}
    )

    has_upload = bool(cv_text.strip())
    name = sanitize_person_name(
        p.get("full_name"),
        cv_identity.get("name"),
    )
    cv_email = (cv_identity.get("email") or "").strip()
    profile_email = (p.get("email") or "").strip()
    if has_upload:
        email = cv_email
        if not email and profile_email and _email_matches_name(profile_email, name):
            email = profile_email
    else:
        email = profile_email
    phone = (p.get("phone") or cv_identity.get("phone") or "").strip()

    roles = p.get("target_roles") or []
    tone = normalize_letter_tone(p.get("letter_tone") or "pro")
    letter_sample = (p.get("letter_sample") or "").strip()
    locs = p.get("target_locations") or []
    location = p.get("location") or (locs[0] if isinstance(locs, list) and locs else "Paris")

    # Toujours partir d'une base vide pour un utilisateur Supabase :
    # le profil de Greg (DEFAULT_PROFILE) ne doit jamais contaminer un autre user.
    base = _empty_user_structured()

    account_name = sanitize_person_name(p.get("full_name"))
    _cache = {
        **base,
        "name": name,
        "email": email,
        "phone": phone,
        "location": location,
        "tagline": summary,
        "cv_text": cv_text,
        "cv_url": cv_url,
        "target_roles": roles,
        "target_sectors": p.get("target_sectors") or [],
        "target_locations": locs,
        "location_search_mode": p.get("location_search_mode") or "city",
        "location_radius_km": p.get("location_radius_km"),
        "contract_type": p.get("contract_type"),
        "remote_pref": p.get("remote_pref"),
        "salary_min": p.get("salary_min"),
        "letter_tone": tone,
        "letter_sample": letter_sample,
        "tone_hint": tone_hint_for(tone, "fr"),
        "_source": "user",
        "_has_uploaded_cv": has_upload,
        "_uid": uid,
        # Identité du compte : filet de sécurité pour l'autofill (jamais pour les CV générés)
        "_account_email": profile_email,
        "_account_name": account_name,
        "_account_phone": (p.get("phone") or "").strip(),
    }
    return _cache


def cv_filename_for(company: str) -> str:
    """Nom de fichier PDF CV adapté au candidat connecté."""
    p = load_user_profile()
    safe_name = re.sub(r"[^\w\-]", "_", (p.get("name") or "Profil").replace(" ", "_"))[:40]
    safe_co = re.sub(r"[^\w\-]", "_", (company or "Offre").replace(" ", "_"))[:40]
    return f"{safe_co}_CV_{safe_name}.pdf"


def candidate_block_for_letter(profile: Dict[str, Any]) -> str:
    display_name = (profile.get("name") or "").strip() or "Candidat"
    lines = [
        f"Nom : {display_name}",
        f"Email : {profile.get('email', '')}",
        f"Téléphone : {profile.get('phone', '')}",
        f"Localisation : {profile.get('location', '')}",
    ]
    if profile.get("target_roles"):
        roles = profile["target_roles"]
        lines.append(
            f"Postes visés : {', '.join(roles) if isinstance(roles, list) else roles}"
        )
    if profile.get("target_sectors"):
        sectors = profile["target_sectors"]
        if isinstance(sectors, list) and sectors:
            lines.append(f"Secteurs visés : {', '.join(sectors)}")
            lines.append(
                "Priorité aux offres dans ces secteurs. Fortement pénaliser le fit si l'offre "
                "est clairement hors secteur (ex. banque, CPAM, administration publique pour un "
                "profil culture/médias)."
            )
    if profile.get("target_locations"):
        locs = profile["target_locations"]
        if isinstance(locs, list) and locs:
            lines.append(f"Lieux recherchés : {', '.join(locs)}")
            if profile.get("location_search_mode") == "city":
                lines.append("Précision localisation : ville uniquement, ne pas élargir.")
            elif profile.get("location_radius_km"):
                lines.append(
                    f"Précision localisation : rayon de {profile.get('location_radius_km')} km autour du lieu principal."
                )
    if profile.get("salary_min"):
        lines.append(f"Salaire minimum souhaité : {profile['salary_min']}k€/an")
    cv = profile.get("cv_text") or ""
    if cv:
        if profile.get("tagline") and profile.get("_source") == "user":
            lines.append(f"Résumé : {profile['tagline']}")
        lines.append("\n--- CV SOURCE (uploadé par le candidat) ---")
        lines.append(cv[:8000])
    elif profile.get("_source") == "default":
        lines.append("\n--- PROFIL STRUCTURÉ (CLI) ---")
        import json
        lines.append(json.dumps(
            {k: v for k, v in profile.items() if k in ("experience", "skills", "education", "tagline")},
            ensure_ascii=False, indent=2,
        )[:6000])
    else:
        lines.append("\n--- PROFIL CANDIDAT (sans CV uploadé) ---")
        if profile.get("tagline"):
            lines.append(f"Parcours : {profile['tagline']}")
        contract = profile.get("contract_type")
        if contract:
            lines.append(
                f"Contrat recherché : {', '.join(contract) if isinstance(contract, list) else contract}"
            )
        remote = profile.get("remote_pref")
        if remote:
            lines.append(
                f"Préférence télétravail : {', '.join(remote) if isinstance(remote, list) else remote}"
            )
        if not profile.get("tagline") and not contract and not remote:
            lines.append(
                "Profil partiel : se baser sur les postes visés, lieux et critères ci-dessus."
            )
    return "\n".join(lines)


def clear_profile_cache():
    global _cache
    _cache = None
