"""
Budget scrape dashboard — ~50 offres max, requêtes adaptées (niche vs marchés larges).
"""
from __future__ import annotations

from typing import Dict, List

SCRAPE_TOTAL_MAX = 50
MAX_MAIN_QUERIES = 6
MAX_NICHE_QUERIES = 2


def _dedupe_lower(items: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for raw in items:
        q = (raw or "").strip()
        if not q or len(q) < 2:
            continue
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(q)
    return out


def _append_unique(dst: List[str], seen: set[str], items: List[str], limit: int) -> None:
    for q in _dedupe_lower(items):
        if len(dst) >= limit:
            return
        k = q.lower()
        if k in seen:
            continue
        seen.add(k)
        dst.append(q)


def build_scrape_queries(roles: List[str], ai: Dict[str, List[str]] | None = None) -> List[str]:
    """
    Ordre : postes profil → primary/secondary IA → 2 niches max.
    """
    ai = ai or {}
    seen: set[str] = set()
    queries: List[str] = []

    _append_unique(queries, seen, roles or [], MAX_MAIN_QUERIES)
    if len(queries) < MAX_MAIN_QUERIES:
        _append_unique(queries, seen, ai.get("primary") or [], MAX_MAIN_QUERIES)
    if len(queries) < MAX_MAIN_QUERIES:
        _append_unique(queries, seen, ai.get("secondary") or [], MAX_MAIN_QUERIES)
    _append_unique(queries, seen, ai.get("niche") or [], MAX_MAIN_QUERIES + MAX_NICHE_QUERIES)

    if not queries and roles:
        return _dedupe_lower(roles)[:MAX_MAIN_QUERIES]
    return queries


def per_query_max(num_queries: int, total: int = SCRAPE_TOTAL_MAX) -> int:
    """Plus de requêtes → moins par requête ; peu de requêtes (niche) → on sonde plus."""
    n = max(1, num_queries)
    if n <= 2:
        return min(25, total)
    if n <= 4:
        return min(18, max(12, (total + n - 1) // n))
    if n <= 6:
        return max(10, min(14, (total + n - 1) // n))
    return max(8, min(12, (total + n - 1) // n))
