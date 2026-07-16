"""
Requêtes LinkedIn personnalisées — Haiku génère des variantes + niches
alignées sur target_roles (plus de city launcher pour un profil customer success).
"""
from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, List

from store import client

QUERY_MODEL = "claude-haiku-4-5-20251001"
MAX_PRIMARY = 6
MAX_NICHE = 10
MAX_SECONDARY = 6


def _criteria_hash(prof: Dict[str, Any]) -> str:
    payload = {
        "target_roles": prof.get("target_roles") or [],
        "target_sectors": prof.get("target_sectors") or [],
        "target_locations": prof.get("target_locations") or [],
        "location_search_mode": prof.get("location_search_mode") or "city",
        "location_radius_km": prof.get("location_radius_km"),
        "summary": (prof.get("summary") or "").strip(),
        "contract_type": prof.get("contract_type"),
        "remote_pref": prof.get("remote_pref"),
    }
    return hashlib.sha1(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def _dedupe_queries(items: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for raw in items:
        q = (raw or "").strip()
        if not q or len(q) < 3:
            continue
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
    return out


def _fallback_queries(roles: List[str]) -> Dict[str, List[str]]:
    roles = _dedupe_queries(roles)
    primary = roles[:MAX_PRIMARY]
    niche: List[str] = []
    for r in roles:
        base = r.strip()
        if not base:
            continue
        niche.extend([
            f"{base} B2B",
            f"{base} SaaS",
            f"senior {base}",
            f"responsable {base}" if not base.lower().startswith("responsable") else base,
        ])
    return {
        "primary": primary,
        "secondary": [],
        "niche": _dedupe_queries(niche)[:MAX_NICHE],
    }


def _contract_query_hint(prof: Dict[str, Any]) -> str:
    contracts = prof.get("contract_type") or []
    if not isinstance(contracts, list):
        return ""
    lowered = [str(c).strip().lower() for c in contracts if str(c).strip()]
    if not lowered:
        return ""
    parts = []
    if any("stage" in c for c in lowered) and not any("alternance" in c for c in lowered):
        parts.append("uniquement des STAGES (pas d'alternance, pas de CDI)")
    elif any("alternance" in c for c in lowered) and not any("stage" in c for c in lowered):
        parts.append("uniquement des ALTERNANCES / apprentissages (pas de stage court, pas de CDI)")
    elif any("stage" in c or "alternance" in c for c in lowered) and not any(
        c in ("cdi", "cdd") or c.startswith("cdi") or c.startswith("cdd") for c in lowered
    ):
        parts.append("uniquement stages et/ou alternances (pas de CDI/CDD)")
    if any(c in ("cdi", "cdd") or c.startswith("cdi") or c.startswith("cdd") for c in lowered) and not any(
        "stage" in c or "alternance" in c for c in lowered
    ):
        parts.append("uniquement CDI/CDD — JAMAIS de stage ni d'alternance dans les requêtes")
    if any("freelance" in c for c in lowered) and not any(
        c in ("cdi", "cdd") or "stage" in c or "alternance" in c for c in lowered
    ):
        parts.append("uniquement missions freelance / contrat / indépendant")
    if not parts:
        parts.append(f"contrats recherchés : {', '.join(contracts)}")
    return " ; ".join(parts)


def _bias_queries_for_contract(queries: List[str], prof: Dict[str, Any]) -> List[str]:
    """Ajoute un mot-clé contrat aux requêtes quand le profil est mono-contrat."""
    from utils.helpers import contract_intent

    intent = contract_intent(prof.get("contract_type") or [], prof.get("target_roles") or [])
    suffix = ""
    if intent["internship_only"]:
        if intent["wants_alternance"] and not intent["wants_stage"]:
            suffix = "alternance"
        elif intent["wants_stage"] and not intent["wants_alternance"]:
            suffix = "stage"
        else:
            suffix = "alternance"
    elif intent["freelance_only"]:
        suffix = "freelance"
    if not suffix:
        return queries
    out: List[str] = []
    for q in queries:
        ql = q.lower()
        if suffix in ql:
            out.append(q)
        else:
            out.append(f"{q} {suffix}")
    return _dedupe_queries(out)


def _generate_with_ai(prof: Dict[str, Any], api_key: str) -> Dict[str, List[str]]:
    import anthropic

    roles = prof.get("target_roles") or []
    sectors = prof.get("target_sectors") or []
    locs = prof.get("target_locations") or []
    loc_mode = prof.get("location_search_mode") or "city"
    loc_radius = prof.get("location_radius_km")
    summary = (prof.get("summary") or "").strip()[:600]
    roles_txt = ", ".join(roles) or "non précisé"
    sectors_txt = ", ".join(sectors) if isinstance(sectors, list) and sectors else "non précisé"
    loc_txt = ", ".join(locs) if isinstance(locs, list) else str(locs or "France")
    if loc_mode == "city":
        loc_scope = "ville uniquement, ne pas élargir aux villes voisines"
    elif loc_radius:
        loc_scope = f"rayon souhaité : {loc_radius} km autour de la ville principale"
    else:
        loc_scope = "rayon standard autour de la ville principale"
    contract_hint = _contract_query_hint(prof)

    prompt = f"""Tu génères des mots-clés de recherche d'offres LinkedIn pour un candidat.

Profil :
- Postes visés : {roles_txt}
- Secteurs visés : {sectors_txt}
- Résumé : {summary or "(non renseigné)"}
- Localisation : {loc_txt}
- Précision localisation : {loc_scope}
- Contrats : {contract_hint or "non précisé"}

Retourne UNIQUEMENT un JSON valide (pas de markdown) :
{{
  "primary": ["..."],   // 4-6 requêtes proches des postes visés (FR + EN)
  "secondary": ["..."], // 4-6 intitulés du même métier / famille de poste
  "niche": ["..."]      // 6-10 variantes de niche DU MÊME DOMAINE (moins évidentes mais pertinentes)
}}

Règles strictes :
- Tout doit rester dans le domaine des postes visés ET des secteurs visés quand ils sont renseignés.
- Ex. culture/médias → musée, spectacle, production audiovisuelle, média culturel — PAS banque, PAS CPAM, PAS administration publique généraliste.
- Ex. customer success → client success, CSM, account manager B2B SaaS — PAS city launcher, PAS ops/marketing hors-sujet.
- Si le contrat est stage/alternance : INCLURE le mot stage ou alternance dans chaque requête.
- Si le contrat est freelance : INCLURE freelance / mission freelance dans les requêtes.
- Si le contrat est CDI/CDD : NE PAS mettre stage, alternance, freelance dans les requêtes.
- Phrases courtes (2-5 mots), titres de poste LinkedIn réalistes.
- Mélange français et anglais comme sur LinkedIn France.
- Pas de noms d'entreprise, pas de guillemets dans les valeurs."""

    msg = anthropic.Anthropic(api_key=api_key).messages.create(
        model=QUERY_MODEL,
        max_tokens=800,
        messages=[{"role": "user", "content": prompt}],
    )
    text = (msg.content[0].text or "").strip()
    for chunk in [text] + (text.split("```") if "```" in text else []):
        chunk = chunk.strip()
        if chunk.startswith("json"):
            chunk = chunk[4:].strip()
        try:
            data = json.loads(chunk)
            return {
                "primary": _bias_queries_for_contract(
                    _dedupe_queries(data.get("primary") or [])[:MAX_PRIMARY], prof
                ),
                "secondary": _bias_queries_for_contract(
                    _dedupe_queries(data.get("secondary") or [])[:MAX_SECONDARY], prof
                ),
                "niche": _bias_queries_for_contract(
                    _dedupe_queries(data.get("niche") or [])[:MAX_NICHE], prof
                ),
            }
        except Exception:
            continue
    fb = _fallback_queries(roles)
    return {
        "primary": _bias_queries_for_contract(fb["primary"], prof),
        "secondary": _bias_queries_for_contract(fb["secondary"], prof),
        "niche": _bias_queries_for_contract(fb["niche"], prof),
    }

def _load_profile(user_id: str) -> Dict[str, Any]:
    try:
        res = client().table("profiles").select("*").eq("id", user_id).maybe_single().execute()
        return res.data or {}
    except Exception:
        return {}


def load_hunt_queries_for_user(user_id: str, api_key: str, *, force: bool = False) -> Dict[str, List[str]]:
    """
    Retourne {primary, secondary, niche} pour hunt-fill dashboard.
    Cache dans app_state tant que les critères profil sont stables.
    """
    prof = _load_profile(user_id)
    roles = prof.get("target_roles") or []
    if not roles and not (prof.get("summary") or "").strip():
        return {"primary": [], "secondary": [], "niche": []}

    h = _criteria_hash(prof)
    cache_id = f"search_queries:{user_id}"

    if not force:
        try:
            row = client().table("app_state").select("data").eq("id", cache_id).maybe_single().execute()
            cached = (row.data or {}).get("data") or {}
            if cached.get("hash") == h and cached.get("niche"):
                return {
                    "primary": cached.get("primary") or [],
                    "secondary": cached.get("secondary") or [],
                    "niche": cached.get("niche") or [],
                }
        except Exception:
            pass

    try:
        generated = _generate_with_ai(prof, api_key)
    except Exception:
        generated = _fallback_queries(roles)

    if not generated.get("primary") and roles:
        generated["primary"] = _bias_queries_for_contract(
            _dedupe_queries(list(roles))[:MAX_PRIMARY], prof
        )

    payload = {**generated, "hash": h, "roles": roles}
    try:
        client().table("app_state").upsert({"id": cache_id, "data": payload}, on_conflict="id").execute()
    except Exception:
        pass

    return generated


def hunt_tiers_for_user(user_id: str, api_key: str, cli_queries: List[str]) -> tuple[List[List[str]], List[str]]:
    """
    Construit tiers + niche_queries pour _run_hunt en mode dashboard.
    """
    ai = load_hunt_queries_for_user(user_id, api_key)
    seed = _dedupe_queries(list(cli_queries) + (ai.get("primary") or []) + (ai.get("secondary") or []))
    tiers: List[List[str]] = []
    if seed:
        tiers.append(seed)
    niche = ai.get("niche") or []
    return tiers, niche
