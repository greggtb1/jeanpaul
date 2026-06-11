"""
Persistance Supabase — remplace les fichiers JSON (jobs.json, seen.json,
applied.json, user_state.json) par des tables Supabase.

Les fonctions gardent volontairement les mêmes noms/signatures que celles
de utils.helpers pour que main.py n'ait quasi rien à changer : on importe
juste depuis `store` au lieu de `utils.helpers`. L'argument `*_file` est
accepté puis ignoré (compat).
"""
import os
import re
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Set
from urllib.parse import urlparse, urlunparse
from urllib.request import urlopen

from dotenv import load_dotenv

# Charge engine/.env (SUPABASE_URL, SUPABASE_KEY, ANTHROPIC_API_KEY)
load_dotenv(Path(__file__).parent / ".env")

from supabase import create_client, Client

_client: Optional[Client] = None
_active_user_id: Optional[str] = None


def set_user(user_id: str):
    """Scope jobs load/save à un utilisateur (dashboard web)."""
    global _active_user_id
    _active_user_id = user_id


def _uid(user_id: Optional[str] = None) -> Optional[str]:
    return user_id or _active_user_id or os.environ.get("JA_USER_ID")


def client() -> Client:
    global _client
    if _client is None:
        url = (
            os.environ.get("SUPABASE_URL")
            or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
            or ""
        )
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or ""
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquants "
                "(.env.local côté Next ou engine/.env)"
            )
        _client = create_client(url, key)
    return _client


def _job_key(job: Dict) -> str:
    """Clé unique d'une offre (URL sinon titre|entreprise)."""
    return job.get("url") or f"{job.get('title', '')}|{job.get('company', '')}".lower()


# ── jobs.json ────────────────────────────────────────────────────────────────

def load_jobs(jobs_file: Path = None, seen_file: Path = None, user_id: str = None) -> List[Dict]:
    """Charge les offres non supprimées depuis Supabase."""
    q = client().table("jobs").select("data,fit_score").eq("deleted", False)
    uid = _uid(user_id)
    if uid:
        q = q.eq("user_id", uid)
    res = q.order("created_at", desc=False).execute()
    jobs: List[Dict] = []
    for row in (res.data or []):
        d = dict(row.get("data") or {})
        fs = row.get("fit_score")
        if isinstance(fs, int) and not isinstance(d.get("_fit_score"), int):
            d["_fit_score"] = fs
        jobs.append(d)
    return jobs


def save_jobs(jobs: List[Dict], jobs_file: Path = None, user_id: str = None):
    """Upsert des offres dans Supabase (clé = url). Ne touche pas applied/deleted."""
    uid = _uid(user_id)
    rows = []
    for job in jobs:
        j = {k: v for k, v in job.items() if k != "raw"}
        if "_analysis" in j and isinstance(j["_analysis"], dict):
            j["_analysis"] = {k: v for k, v in j["_analysis"].items() if k != "job"}
        fit = _coerce_fit_score({"fit_score": j.get("fit_score"), "data": j})
        if fit is None:
            fs = j.get("_fit_score")
            if isinstance(fs, (int, float)) and not isinstance(fs, bool):
                fit = int(round(fs))
        row = {
            "url": _job_key(j),
            "data": j,
        }
        if fit is not None:
            row["fit_score"] = fit
        if uid:
            row["user_id"] = uid
        rows.append(row)
    if rows:
        client().table("jobs").upsert(rows, on_conflict="user_id,url").execute()


# ── seen.json ────────────────────────────────────────────────────────────────

def load_seen(seen_file: Path = None, user_id: str = None) -> set:
    uid = _uid(user_id)
    q = client().table("seen_urls").select("key")
    if uid:
        q = q.eq("user_id", uid)
    res = q.execute()
    return {row["key"] for row in (res.data or [])}


def save_seen(seen: set, seen_file: Path = None, user_id: str = None):
    uid = _uid(user_id)
    if not uid:
        return
    rows = [{"key": k, "user_id": uid} for k in seen if k]
    if rows:
        client().table("seen_urls").upsert(rows, on_conflict="user_id,key").execute()


# ── applied.json ─────────────────────────────────────────────────────────────

def load_applied(applied_file: Path = None, user_id: str = None) -> set:
    uid = _uid(user_id)
    q = client().table("applied_keys").select("key")
    if uid:
        q = q.eq("user_id", uid)
    res = q.execute()
    return {row["key"] for row in (res.data or [])}


def save_applied(applied: set, applied_file: Path = None, user_id: str = None):
    """Track des candidatures GÉNÉRÉES (docs créés) — ne marque PAS le job
    comme soumis : jobs.applied est réservé à la soumission réelle."""
    uid = _uid(user_id)
    if not uid:
        return
    rows = [{"key": k, "user_id": uid} for k in applied if k]
    if rows:
        client().table("applied_keys").upsert(rows, on_conflict="user_id,key").execute()


def mark_submitted(url: str, user_id: str = None):
    """Marque une offre comme réellement soumise (après auto-apply confirmé)."""
    if not url:
        return
    uid = _uid(user_id)
    try:
        q = client().table("jobs").update({"applied": True}).eq("url", url)
        if uid:
            q = q.eq("user_id", uid)
        q.execute()
    except Exception:
        pass


# ── user_state.json (état dashboard) ─────────────────────────────────────────

def _state_id(user_id: str = None) -> str:
    uid = _uid(user_id)
    return f"state:{uid}" if uid else "default"


def load_state(user_id: str = None) -> Dict:
    state_id = _state_id(user_id)
    res = client().table("app_state").select("data").eq("id", state_id).execute()
    if res.data:
        return res.data[0]["data"] or {"applied": {}, "deleted": []}
    return {"applied": {}, "deleted": []}


def save_state(state: Dict, user_id: str = None):
    state_id = _state_id(user_id)
    uid = _uid(user_id)
    row = {"id": state_id, "data": state}
    if uid:
        row["user_id"] = uid
    client().table("app_state").upsert(row, on_conflict="id").execute()


# ── Pipeline runs (logs dashboard) ───────────────────────────────────────────

def pipeline_create(user_id: str, run_id: str):
    client().table("pipeline_runs").insert({
        "id": run_id,
        "user_id": user_id,
        "status": "pending",
        "log": "",
        "progress": 0,
    }).execute()


def pipeline_set_status(run_id: str, status: str, progress: int = None):
    upd = {"status": status}
    if progress is not None:
        upd["progress"] = progress
    client().table("pipeline_runs").update(upd).eq("id", run_id).execute()


def pipeline_log(run_id: str, line: str, progress: int = None):
    if not line:
        return
    res = client().table("pipeline_runs").select("log").eq("id", run_id).single().execute()
    prev = res.data.get("log") or ""
    upd = {"log": prev + line + ("\n" if not line.endswith("\n") else "")}
    if progress is not None:
        upd["progress"] = progress
    client().table("pipeline_runs").update(upd).eq("id", run_id).execute()


def pipeline_finish(run_id: str, status: str, result: dict = None):
    from datetime import datetime, timezone
    res = client().table("pipeline_runs").select("progress").eq("id", run_id).single().execute()
    prog = 100 if status == "done" else int(res.data.get("progress") or 0)
    upd = {
        "status": status,
        "progress": prog,
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }
    if result is not None:
        upd["result"] = result
    client().table("pipeline_runs").update(upd).eq("id", run_id).execute()


def pipeline_register_pid(run_id: str, pid: int):
    try:
        client().table("app_state").upsert(
            {"id": f"pipeline_pid:{run_id}", "data": {"pid": pid}},
            on_conflict="id",
        ).execute()
    except Exception:
        pass


def pipeline_request_cancel(run_id: str):
    from datetime import datetime, timezone
    try:
        client().table("app_state").upsert(
            {
                "id": f"pipeline_cancel:{run_id}",
                "data": {"cancelled": True, "at": datetime.now(timezone.utc).isoformat()},
            },
            on_conflict="id",
        ).execute()
    except Exception:
        pass


def pipeline_clear_cancel(run_id: str):
    try:
        client().table("app_state").delete().eq("id", f"pipeline_cancel:{run_id}").execute()
    except Exception:
        pass


def pipeline_is_cancelled(run_id: str) -> bool:
    try:
        res = (
            client()
            .table("app_state")
            .select("data")
            .eq("id", f"pipeline_cancel:{run_id}")
            .maybe_single()
            .execute()
        )
        return bool((res.data or {}).get("data", {}).get("cancelled"))
    except Exception:
        return False


def pipeline_get_pid(run_id: str) -> Optional[int]:
    try:
        res = (
            client()
            .table("app_state")
            .select("data")
            .eq("id", f"pipeline_pid:{run_id}")
            .maybe_single()
            .execute()
        )
        pid = (res.data or {}).get("data", {}).get("pid")
        return int(pid) if pid is not None else None
    except Exception:
        return None


def pipeline_run_status(run_id: str) -> Optional[str]:
    try:
        res = client().table("pipeline_runs").select("status").eq("id", run_id).single().execute()
        return res.data.get("status")
    except Exception:
        return None


def pipeline_cancel(run_id: str, summary: str = None):
    """Marque le run comme annulé (idempotent)."""
    pipeline_request_cancel(run_id)
    st = pipeline_run_status(run_id)
    if st not in ("running", "pending"):
        return
    if summary:
        pipeline_log(run_id, summary)
    else:
        pipeline_log(run_id, "\n🛑 Recherche arrêtée par l'utilisateur.")
    pipeline_finish(run_id, "cancelled", {"cancelled": True})


def pipeline_latest(user_id: str) -> Optional[dict]:
    res = (
        client()
        .table("pipeline_runs")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def upload_app_documents(user_id: str, output_dir: Path) -> int:
    """Upload les CV (pdf) et lettres (txt/docx) des dossiers applications/ vers le
    bucket Storage `cvs`, puis renseigne cv_url / letter_url sur les jobs.
    Retourne le nombre de jobs mis à jour."""
    import json as _json
    import mimetypes
    import re as _re
    import unicodedata as _ud

    def _safe(s: str) -> str:
        """Clé Storage ASCII-safe (les accents font échouer l'upload)."""
        nfkd = _ud.normalize("NFKD", s)
        ascii_s = nfkd.encode("ascii", "ignore").decode("ascii")
        return _re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_s).strip("_") or "doc"

    storage = client().storage.from_("cvs")
    updated = 0

    for d in sorted(Path(output_dir).glob("*/")):
        ji = d / "job_info.json"
        if not ji.exists():
            continue
        try:
            info = _json.loads(ji.read_text(encoding="utf-8"))
        except Exception:
            continue
        job_url = (info.get("job", {}).get("url") or "").strip()
        if not job_url:
            continue

        cvs = sorted(d.glob("*.pdf"))
        letters = sorted(d.glob("LettreMotivation_*.txt"))
        if not letters:
            letters = sorted(d.glob("LettreMotivation_*.docx"))
        upd = {}
        for field, files in (("cv_url", cvs), ("letter_url", letters)):
            if not files:
                continue
            f = files[0]
            path = f"apps/{user_id}/{_safe(d.name)}/{_safe(f.name)}"
            ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            if f.suffix.lower() == ".txt":
                ctype = "text/plain; charset=utf-8"
            try:
                storage.upload(
                    path,
                    f.read_bytes(),
                    {
                        "content-type": ctype,
                        "upsert": "true",
                    },
                )
                signed = storage.create_signed_url(path, 60 * 60 * 24 * 365)
                upd[field] = signed.get("signedURL") or signed.get("signedUrl") or storage.get_public_url(path)
            except Exception:
                continue

        if upd:
            try:
                q = client().table("jobs").update(upd).eq("url", job_url)
                if user_id:
                    q = q.eq("user_id", user_id)
                q.execute()
                updated += 1
            except Exception:
                pass

    return updated


def recent_generated_urls(user_id: str) -> List[str]:
    """URLs des offres dont le CV+lettre ont été générés lors de la dernière recherche."""
    try:
        res = (
            client()
            .table("pipeline_runs")
            .select("result, created_at")
            .eq("user_id", user_id)
            .eq("status", "done")
            .order("created_at", ascending=False)
            .limit(8)
            .execute()
        )
        for run in res.data or []:
            r = run.get("result") or {}
            if r.get("mode") != "full":
                continue
            urls = r.get("generated_urls") or []
            if urls:
                return [u for u in urls if u]
        for run in res.data or []:
            r = run.get("result") or {}
            urls = r.get("generated_urls") or []
            if urls:
                return [u for u in urls if u]
    except Exception:
        pass
    return []


def _coerce_fit_score(row: Dict) -> Optional[int]:
    """fit_score colonne ou data._fit_score (int/float/str)."""
    for raw in (row.get("fit_score"), (row.get("data") or {}).get("_fit_score")):
        if raw is None:
            continue
        if isinstance(raw, bool):
            continue
        if isinstance(raw, (int, float)):
            return int(round(raw))
        if isinstance(raw, str):
            s = raw.strip()
            if s.isdigit():
                return int(s)
            try:
                return int(round(float(s)))
            except ValueError:
                continue
    return None


def _normalize_job_url(url: str) -> str:
    """Canonicalise les URLs LinkedIn / ATS pour matcher dashboard ↔ Supabase."""
    u = (url or "").strip()
    if not u:
        return ""
    try:
        p = urlparse(u)
        host = (p.netloc or "").lower()
        path = (p.path or "").rstrip("/")
        if "linkedin.com" in host:
            host = "www.linkedin.com"
            path = re.sub(r"/+$", "", path)
        return urlunparse((p.scheme or "https", host, path, "", "", "")).rstrip("/")
    except Exception:
        return u.split("?")[0].rstrip("/")


def _url_match_keys(url: str) -> Set[str]:
    """Variantes d'une URL pour comparaison souple."""
    keys: Set[str] = set()
    raw = (url or "").strip()
    if not raw:
        return keys
    keys.add(raw)
    keys.add(raw.rstrip("/"))
    norm = _normalize_job_url(raw)
    if norm:
        keys.add(norm)
        keys.add(norm.rstrip("/"))
    bare = raw.split("?")[0].rstrip("/")
    keys.add(bare)
    return {k for k in keys if k}


def _urls_overlap(a: str, b: str) -> bool:
    return bool(_url_match_keys(a) & _url_match_keys(b))


def _selection_url_set(urls: Optional[List[str]]) -> Optional[Set[str]]:
    if urls is None:
        return None
    out: Set[str] = set()
    for u in urls:
        out.update(_url_match_keys(u))
    return out


def _row_is_ready(row: Dict, min_score: int) -> bool:
    if row.get("applied"):
        return False
    if not row.get("cv_url") or not row.get("letter_url"):
        return False
    score = _coerce_fit_score(row)
    return score is not None and score >= min_score


def save_autoapply_selection(user_id: str, urls: List[str]) -> None:
    """URLs choisies dans le dashboard pour la prochaine run auto-apply."""
    clean = list(dict.fromkeys(
        (u or "").strip() for u in urls if u and str(u).strip()
    ))
    if not user_id or not clean:
        return
    try:
        client().table("app_state").upsert(
            {
                "id": f"autoapply_selection:{user_id}",
                "user_id": user_id,
                "data": {"urls": clean},
            },
            on_conflict="id",
        ).execute()
    except Exception:
        pass


def load_autoapply_selection(user_id: str) -> Optional[List[str]]:
    try:
        res = (
            client()
            .table("app_state")
            .select("data")
            .eq("id", f"autoapply_selection:{user_id}")
            .maybe_single()
            .execute()
        )
        if not res.data:
            return None
        urls = (res.data.get("data") or {}).get("urls") or []
        clean = [u.strip() for u in urls if u and u.strip()]
        return clean or None
    except Exception:
        return None


def clear_autoapply_selection(user_id: str) -> None:
    try:
        client().table("app_state").delete().eq("id", f"autoapply_selection:{user_id}").execute()
    except Exception:
        pass


def list_autoapply_jobs(
    user_id: str,
    min_score: int = 6,
    recent_urls: Optional[List[str]] = None,
) -> List[Dict]:
    """Offres prêtes (CV + lettre) pour l'auto-apply dashboard."""
    selection = _selection_url_set(recent_urls)
    rows: List[Dict] = []

    try:
        if selection:
            # Requête directe par URL (+ variantes sans query string)
            url_variants = sorted(selection)
            res = (
                client()
                .table("jobs")
                .select("url,data,fit_score,cv_url,letter_url,applied,updated_at")
                .eq("user_id", user_id)
                .eq("deleted", False)
                .eq("applied", False)
                .in_("url", url_variants)
                .execute()
            )
            rows = list(res.data or [])

            if len(rows) < len(recent_urls or []):
                res_all = (
                    client()
                    .table("jobs")
                    .select("url,data,fit_score,cv_url,letter_url,applied,updated_at")
                    .eq("user_id", user_id)
                    .eq("deleted", False)
                    .eq("applied", False)
                    .execute()
                )
                seen = {r.get("url") for r in rows}
                for row in res_all.data or []:
                    url = (row.get("url") or "").strip()
                    if url in seen:
                        continue
                    if any(_urls_overlap(url, sel) for sel in (recent_urls or [])):
                        rows.append(row)
                        seen.add(url)
        else:
            res = (
                client()
                .table("jobs")
                .select("url,data,fit_score,cv_url,letter_url,applied,updated_at")
                .eq("user_id", user_id)
                .eq("deleted", False)
                .eq("applied", False)
                .execute()
            )
            rows = list(res.data or [])
    except Exception:
        return []

    ready: List[Dict] = []
    for row in rows:
        if not _row_is_ready(row, min_score):
            continue
        url = (row.get("url") or "").strip()
        if selection is not None:
            keys = _url_match_keys(url)
            if not (keys & selection) and not any(
                _urls_overlap(url, sel) for sel in (recent_urls or [])
            ):
                continue
        if _coerce_fit_score(row) is not None:
            row = dict(row)
            row["fit_score"] = _coerce_fit_score(row)
        ready.append(row)

    ready.sort(key=lambda r: r.get("updated_at") or "", reverse=True)
    return ready


def find_app_dir(output_dir: Path, job_url: str) -> Optional[Path]:
    """Trouve le dossier applications/ correspondant à une URL d'offre."""
    import json as _json

    target = (job_url or "").strip().rstrip("/")
    if not target:
        return None
    for d in sorted(Path(output_dir).glob("*/")):
        ji = d / "job_info.json"
        if not ji.exists():
            continue
        try:
            info = _json.loads(ji.read_text(encoding="utf-8"))
            jurl = (info.get("job", {}).get("url") or "").strip().rstrip("/")
            if jurl == target:
                return d
        except Exception:
            continue
    return None


def _download_bytes(url: str) -> bytes:
    with urlopen(url, timeout=45) as resp:
        return resp.read()


def ensure_local_docs(
    job_row: Dict,
    output_dir: Path,
) -> Tuple[Optional[Path], Path, str]:
    """
    Retourne (app_dir, cv_path, letter_text) pour une offre Supabase.
    Télécharge depuis Storage si les fichiers locaux manquent.
    """
    import json as _json
    import re as _re
    import unicodedata as _ud

    url = (job_row.get("url") or "").strip()
    data = job_row.get("data") or {}
    company = (data.get("company") or "Offre").strip()
    title = (data.get("title") or "").strip()

    app_dir = find_app_dir(output_dir, url)
    if not app_dir:
        def _safe(s: str) -> str:
            nfkd = _ud.normalize("NFKD", s)
            ascii_s = nfkd.encode("ascii", "ignore").decode("ascii")
            return _re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_s).strip("_") or "offre"

        app_dir = output_dir / f"auto_{_safe(company)[:40]}"
        app_dir.mkdir(parents=True, exist_ok=True)
        job_payload = {**data, "url": url}
        (app_dir / "job_info.json").write_text(
            _json.dumps(
                {"job": job_payload, "fit_score": job_row.get("fit_score")},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    cv_path = Path("")
    cv_files = sorted(app_dir.glob("*.pdf"))
    if cv_files:
        cv_path = cv_files[0]
    elif job_row.get("cv_url"):
        try:
            cv_path = app_dir / "CV_auto.pdf"
            cv_path.write_bytes(_download_bytes(job_row["cv_url"]))
        except Exception:
            cv_path = Path("")

    letter_text = ""
    for txt in sorted(app_dir.glob("LettreMotivation_*.txt")):
        try:
            letter_text = txt.read_text(encoding="utf-8").strip()
            break
        except Exception:
            pass
    if not letter_text and job_row.get("letter_url"):
        try:
            letter_text = _download_bytes(job_row["letter_url"]).decode("utf-8", errors="replace").strip()
            (app_dir / f"LettreMotivation_{company.replace(' ', '_')[:30]}.txt").write_text(
                letter_text, encoding="utf-8"
            )
        except Exception:
            letter_text = ""

    return app_dir, cv_path, letter_text


def blacklist_url(url: str, user_id: str = None):
    """Ajoute une URL à seen + marque le job supprimé."""
    uid = _uid(user_id)
    if not url:
        return
    if uid:
        client().table("seen_urls").upsert(
            {"key": url, "user_id": uid}, on_conflict="user_id,key"
        ).execute()
    try:
        q = client().table("jobs").update({"deleted": True}).eq("url", url)
        if uid:
            q = q.eq("user_id", uid)
        q.execute()
    except Exception:
        pass
