"""
Profil candidat pour la génération CV / lettres — chargé depuis Supabase
(profil onboarding + texte extrait du CV PDF uploadé).
"""
import os
import re
from io import BytesIO
from typing import Any, Dict, Optional
from urllib.request import urlopen

from profile import PROFILE as DEFAULT_PROFILE

_TONE_HINTS = {
    "pro": "Professionnel et posé, classique, rassurant.",
    "direct": "Direct et efficace, court, sans détour.",
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

    "direct": """TON DEMANDÉ : Direct & efficace (PRIORITÉ ÉLEVÉE — la lettre doit clairement sonner ainsi)

Applique ce ton sur toute la lettre :
- Phrases courtes. Zéro circonvolution. Zéro remplissage.
- Aller droit au fait : compétence → lien avec le poste → ouverture
- Pas de formules creuses ni d'adjectifs vides ("dynamique", "motivé", "passionné")
- Chaque phrase doit apporter une info concrète

Référence de rythme (adapter au candidat et à l'offre, ne pas recopier) :
« J'ai piloté une activité B2B de A à Z : 850k€ de CA, 30 partenaires, process qui tiennent sous charge. Votre poste cherche exactement ça. On en parle ? »""",

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
    "direct": "Direct and efficient, short, no fluff.",
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

    "direct": """REQUESTED TONE: Direct & efficient (HIGH PRIORITY — the letter must clearly sound like this)

Apply this tone throughout:
- Short sentences. Zero fluff. Zero filler.
- Get to the point: skill → link to role → opening
- No empty formulas or hollow adjectives ("dynamic", "motivated", "passionate")
- Every sentence must carry concrete information

Rhythm reference (adapt to candidate and role, do not copy):
"I ran a B2B operation end to end: €850k revenue, 30 partners, processes that held under load. Your role is looking for exactly that. Worth a chat?""",

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


def tone_hint_for(tone_id: str, lang: str = "fr") -> str:
    hints = _TONE_HINTS_EN if lang == "en" else _TONE_HINTS
    return hints.get(tone_id, hints["pro"])


def tone_block_for_letter(tone_id: str, lang: str = "fr") -> str:
    blocks = _TONE_BLOCKS_EN if lang == "en" else _TONE_BLOCKS
    return blocks.get(tone_id, blocks["pro"])

_cache: Optional[Dict[str, Any]] = None


def _storage_path_from_public_url(url: str) -> Optional[str]:
    for marker in ("/storage/v1/object/public/cvs/", "/storage/v1/object/sign/cvs/"):
        if marker in url:
            return url.split(marker, 1)[1].split("?")[0]
    return None


def _pdf_bytes_to_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(data))
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
}

def _looks_like_name_line(line: str) -> bool:
    cleaned = re.sub(r"\s+", " ", (line or "").strip())
    if len(cleaned) < 4 or len(cleaned) > 55:
        return False
    if _EMAIL_RE.search(cleaned) or _PHONE_RE.search(cleaned):
        return False
    if re.search(r"\d{2,}", cleaned):
        return False
    if re.match(r"^(cv|curriculum|vitae|profil|expérience|experience|compétence|contact)", cleaned, re.I):
        return False
    words = cleaned.split()
    if len(words) < 2 or len(words) > 5:
        return False
    if not all(re.match(r"^[A-Za-zÀ-ÿ'’-]+$", w) for w in words):
        return False
    lower_words = [w.lower() for w in words]
    if any(w in _NAME_STOP_WORDS for w in lower_words):
        return False
    if all(len(w) <= 4 for w in lower_words):
        return False
    return True


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

    if not p.get("full_name") and not p.get("cv_url"):
        # Utilisateur Supabase sans profil rempli : partir d'une base vide, jamais du profil de Greg.
        _cache = {
            **_empty_user_structured(),
            "name": "",
            "email": "",
            "phone": "",
            "_source": "user",
            "_has_uploaded_cv": False,
            "_uid": uid,
            # Identité du compte : filet de sécurité pour l'autofill (jamais pour les CV générés)
            "_account_email": (p.get("email") or "").strip(),
            "_account_name": (p.get("full_name") or "").strip(),
            "_account_phone": (p.get("phone") or "").strip(),
        }
        return _cache

    cv_url = (p.get("cv_url") or "").strip()
    cv_filename = (p.get("cv_filename") or "").strip()
    cv_text = _extract_pdf_text(cv_url) if cv_url else ""
    cv_identity = (
        _parse_identity_from_cv_text(cv_text, cv_filename) if cv_text.strip() else {}
    )

    has_upload = bool(cv_text.strip())
    name = (p.get("full_name") or cv_identity.get("name") or "").strip()
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
    tone = p.get("letter_tone") or "pro"
    letter_sample = (p.get("letter_sample") or "").strip()
    locs = p.get("target_locations") or []
    location = p.get("location") or (locs[0] if isinstance(locs, list) and locs else "Paris")

    # Toujours partir d'une base vide pour un utilisateur Supabase :
    # le profil de Greg (DEFAULT_PROFILE) ne doit jamais contaminer un autre user.
    base = _empty_user_structured()

    _cache = {
        **base,
        "name": name,
        "email": email,
        "phone": phone,
        "location": location,
        "tagline": (p.get("summary") or "").strip(),
        "cv_text": cv_text,
        "cv_url": cv_url,
        "target_roles": roles,
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
        "_account_name": (p.get("full_name") or "").strip(),
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
    lines = [
        f"Nom : {profile.get('name', '')}",
        f"Email : {profile.get('email', '')}",
        f"Téléphone : {profile.get('phone', '')}",
        f"Localisation : {profile.get('location', '')}",
    ]
    if profile.get("target_roles"):
        lines.append(f"Postes visés : {', '.join(profile['target_roles'])}")
    if profile.get("salary_min"):
        lines.append(f"Salaire minimum souhaité : {profile['salary_min']}k€/an")
    if profile.get("tagline") and profile.get("_source") == "user":
        lines.append(f"Résumé : {profile['tagline']}")
    cv = profile.get("cv_text") or ""
    if cv:
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
        # Utilisateur Supabase sans CV uploadé : donner un maximum de contexte
        # depuis son profil d'onboarding pour que Claude ne devine pas.
        notes = []
        if profile.get("tagline"):
            notes.append(f"Résumé : {profile['tagline']}")
        contract = profile.get("contract_type")
        if contract:
            notes.append(f"Contrat recherché : {', '.join(contract) if isinstance(contract, list) else contract}")
        remote = profile.get("remote_pref")
        if remote:
            notes.append(f"Préférence télétravail : {', '.join(remote) if isinstance(remote, list) else remote}")
        if notes:
            lines.append("\n--- INFORMATIONS PROFIL (pas de CV uploadé) ---")
            lines.extend(notes)
        else:
            lines.append("\n(Aucun CV uploadé — se baser uniquement sur les postes visés et la localisation)")
    return "\n".join(lines)


def clear_profile_cache():
    global _cache
    _cache = None
