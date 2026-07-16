"""Offres fictives floutées après le premier scan découverte (8–12, score 6–7)."""
import random
import uuid

from store import client, pipeline_log

DECOY_COMPANIES = [
    "Nova Consulting",
    "Bright Media",
    "Helios Tech",
    "Urban Partners",
    "Celsius Group",
    "Alpine Digital",
    "Meridian RH",
    "Horizon Labs",
    "Studio Fusion",
    "Atlas Ventures",
    "Pulse Analytics",
    "Rubis Conseil",
    "Lumen Studio",
    "Vectis Services",
    "Coraline SaaS",
]

CITIES = ["Paris", "Lyon", "Bordeaux", "Nantes", "Lille", "Marseille", "Remote"]

ROLE_TEMPLATES = [
    "{role}",
    "{role} · CDI",
    "{role} (H/F)",
    "{role} · hybride",
]


def _already_seeded(user_id: str) -> bool:
    try:
        res = (
            client()
            .table("app_state")
            .select("id")
            .eq("id", f"trial_decoy_seeded:{user_id}")
            .maybe_single()
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def seed_trial_decoy_jobs(user_id: str, run_id: str) -> int:
    """Insère des offres teaser une seule fois après le premier scan essai."""
    if _already_seeded(user_id):
        return 0

    try:
        res = (
            client()
            .table("profiles")
            .select("subscription_status,is_trial,target_roles,target_locations")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        prof = res.data or {}
    except Exception:
        return 0

    if prof.get("subscription_status") != "trial" and not prof.get("is_trial"):
        return 0

    roles = [r for r in (prof.get("target_roles") or []) if isinstance(r, str) and r.strip()]
    if not roles:
        roles = ["Chef de projet", "Product Manager", "Consultant"]

    locs = [l for l in (prof.get("target_locations") or []) if isinstance(l, str) and l.strip()]
    if not locs:
        locs = CITIES[:4]

    count = random.randint(8, 12)
    rows = []
    used_titles: set[str] = set()

    for _ in range(count):
        role = random.choice(roles)
        title = random.choice(ROLE_TEMPLATES).format(role=role)
        n = 0
        while title in used_titles and n < 8:
            title = random.choice(ROLE_TEMPLATES).format(role=random.choice(roles))
            n += 1
        used_titles.add(title)

        company = random.choice(DECOY_COMPANIES)
        location = random.choice(locs)
        score = random.randint(6, 7)
        decoy_id = uuid.uuid4().hex[:12]
        url = f"https://trial.blowmyjob.fr/decoy/{user_id[:8]}/{decoy_id}"

        rows.append(
            {
                "user_id": user_id,
                "url": url,
                "fit_score": score,
                "deleted": False,
                "data": {
                    "title": title,
                    "company": company,
                    "location": location,
                    "url": url,
                    "trial_decoy": True,
                    "platform": "decoy",
                    "_fit_score": score,
                },
            }
        )

    if not rows:
        return 0

    client().table("jobs").upsert(rows, on_conflict="user_id,url").execute()
    client().table("app_state").upsert(
        {
            "id": f"trial_decoy_seeded:{user_id}",
            "user_id": user_id,
            "data": {"count": count},
        },
        on_conflict="id",
    ).execute()

    pipeline_log(
        run_id,
        f"✓ {count} offre(s) bonus repérées — débloquables avec un plan",
    )
    return count


def delete_trial_decoy_jobs(user_id: str, run_id=None) -> int:
    """Soft-delete des offres floutées (après paiement / déblocage)."""
    from datetime import datetime, timezone

    try:
        res = (
            client()
            .table("jobs")
            .select("url,data")
            .eq("user_id", user_id)
            .eq("deleted", False)
            .execute()
        )
    except Exception:
        return 0

    urls = []
    for row in res.data or []:
        url = row.get("url")
        data = row.get("data") or {}
        if data.get("trial_decoy") or str(url or "").startswith(
            "https://trial.blowmyjob.fr/decoy/"
        ):
            if url:
                urls.append(url)

    if not urls:
        return 0

    now = datetime.now(timezone.utc).isoformat()
    client().table("jobs").update({"deleted": True, "updated_at": now}).eq(
        "user_id", user_id
    ).in_("url", urls).execute()

    if run_id:
        pipeline_log(run_id, f"🧹 {len(urls)} offre(s) floutée(s) retirée(s)")
    return len(urls)
