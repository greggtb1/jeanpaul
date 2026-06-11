"""
Workers RQ — pipeline scrape → analyze → generate → autofill.
Chaque worker tourne dans un process séparé et écrit ses logs dans Task.log
pour streaming SSE vers le frontend.
"""
import json
import traceback
from datetime import datetime
from pathlib import Path
from uuid import UUID

from rq import get_current_job
import redis
from app.core.config import settings

# Client Redis partagé pour l'enqueue
_redis = redis.from_url(settings.REDIS_URL)


# ── Enqueue helpers ────────────────────────────────────────────────────────────

def enqueue_scrape(task_id: str, user_id: str, payload: dict):
    from rq import Queue
    q = Queue("scrape", connection=_redis)
    q.enqueue(run_scrape, task_id, user_id, payload, job_timeout=600)


def enqueue_analyze(task_id: str, user_id: str, job_id: str):
    from rq import Queue
    q = Queue("analyze", connection=_redis)
    q.enqueue(run_analyze, task_id, user_id, job_id, job_timeout=120)


def enqueue_generate(task_id: str, user_id: str, job_id: str):
    from rq import Queue
    q = Queue("generate", connection=_redis)
    q.enqueue(run_generate, task_id, user_id, job_id, job_timeout=300)


def enqueue_autofill(task_id: str, user_id: str, job_id: str):
    from rq import Queue
    q = Queue("autofill", connection=_redis)
    q.enqueue(run_autofill, task_id, user_id, job_id, job_timeout=600)


def enqueue_pipeline(task_id: str, user_id: str, payload: dict):
    from rq import Queue
    q = Queue("pipeline", connection=_redis)
    q.enqueue(run_full_pipeline, task_id, user_id, payload, job_timeout=1800)


# ── Runner helpers ─────────────────────────────────────────────────────────────

def _get_sync_db():
    """Session SQLAlchemy synchrone pour les workers (pas d'asyncio dans RQ)."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    # Remplace asyncpg par psycopg2 pour le context sync
    sync_url = settings.DATABASE_URL.replace("+asyncpg", "")
    engine = create_engine(sync_url)
    Session = sessionmaker(engine)
    return Session()


def _log(db, task_id: str, msg: str, progress: int = None):
    """Ajoute une ligne de log à la tâche (temps réel via SSE)."""
    from app.models import Task
    task = db.query(Task).filter(Task.id == task_id).first()
    if task:
        task.log = (task.log or "") + msg + "\n"
        if progress is not None:
            task.progress = progress
        db.commit()


def _fail(db, task_id: str, error: str):
    from app.models import Task, TaskStatus
    task = db.query(Task).filter(Task.id == task_id).first()
    if task:
        task.status = TaskStatus.failed
        task.result = {"error": error}
        task.finished_at = datetime.utcnow()
        db.commit()


def _done(db, task_id: str, result: dict):
    from app.models import Task, TaskStatus
    task = db.query(Task).filter(Task.id == task_id).first()
    if task:
        task.status = TaskStatus.done
        task.result = result
        task.finished_at = datetime.utcnow()
        task.progress = 100
        db.commit()


# ── Workers ────────────────────────────────────────────────────────────────────

def run_scrape(task_id: str, user_id: str, payload: dict):
    """Scrape LinkedIn + WTTJ et insère les nouvelles offres en DB."""
    db = _get_sync_db()
    try:
        from app.models import Task, TaskStatus, Job, User
        task = db.query(Task).filter(Task.id == task_id).first()
        task.status = TaskStatus.running
        task.started_at = datetime.utcnow()
        db.commit()

        user = db.query(User).filter(User.id == user_id).first()
        api_key = user.anthropic_key or settings.ANTHROPIC_API_KEY

        platforms = payload.get("platforms", ["linkedin", "wttj"])
        queries   = payload.get("queries", ["ops manager", "head of ops"])
        locations = payload.get("locations", ["Paris"])
        max_r     = payload.get("max_per_query", 10)
        recent_days = payload.get("recent_days", 7)

        # URLs déjà vues pour cet user
        existing_urls = {j.url for j in db.query(Job.url).filter(Job.user_id == user_id).all()}

        new_jobs = []
        total_queries = len(platforms) * len(queries) * len(locations)
        done_q = 0

        for platform in platforms:
            for query in queries:
                for location in locations:
                    _log(db, task_id, f"🔍 {platform.upper()} → {query} ({location})")
                    try:
                        jobs = _scrape_platform(platform, query, location, max_r, recent_days)
                        fresh = [j for j in jobs if j.get("url") and j["url"] not in existing_urls]
                        _log(db, task_id, f"   {len(fresh)} nouvelles offres")
                        new_jobs.extend(fresh)
                        for j in fresh:
                            existing_urls.add(j["url"])
                    except Exception as e:
                        _log(db, task_id, f"   ⚠ Erreur : {str(e)[:100]}")

                    done_q += 1
                    _log(db, task_id, "", progress=int(done_q / total_queries * 80))

        # Insère en DB
        inserted = 0
        for jdata in new_jobs:
            job = Job(
                user_id=user_id,
                title=jdata.get("title", ""),
                company=jdata.get("company", ""),
                location=jdata.get("location", ""),
                url=jdata.get("url", ""),
                platform=jdata.get("platform", platform),
                description=jdata.get("description", ""),
                salary_raw=jdata.get("salary", ""),
                published_at=jdata.get("published_at"),
            )
            db.add(job)
            inserted += 1

        db.commit()
        _log(db, task_id, f"✅ {inserted} offres insérées", progress=100)
        _done(db, task_id, {"inserted": inserted})

    except Exception as e:
        _fail(db, task_id, traceback.format_exc())
    finally:
        db.close()


def run_analyze(task_id: str, user_id: str, job_id: str):
    """Analyse une offre avec Claude et met à jour le fit_score."""
    db = _get_sync_db()
    try:
        from app.models import Task, TaskStatus, Job, JobStatus, User
        task = db.query(Task).filter(Task.id == task_id).first()
        task.status = TaskStatus.running
        task.started_at = datetime.utcnow()
        db.commit()

        user = db.query(User).filter(User.id == user_id).first()
        job  = db.query(Job).filter(Job.id == job_id).first()
        api_key = user.anthropic_key or settings.ANTHROPIC_API_KEY

        _log(db, task_id, f"🧠 Analyse : {job.company} — {job.title}")

        # Import de l'analyzer existant
        import sys
        sys.path.insert(0, "/app/shared")  # répertoire du code partagé avec le monorepo
        from generators.analyzer import JobAnalyzer
        from app.services.profile_adapter import profile_to_local_format

        profile = db.query(__import__("app.models", fromlist=["UserProfile"]).UserProfile).filter_by(user_id=user_id).first()
        job_dict = {"title": job.title, "company": job.company, "description": job.description, "url": job.url}
        analyzer = JobAnalyzer(api_key=api_key, model=settings.ANALYSIS_MODEL)
        result = analyzer.analyze(job_dict)

        job.fit_score = result.get("fit_score")
        job.fit_reasoning = result.get("fit_reasoning")
        job.role_summary = result.get("role_summary")
        job.key_responsibilities = result.get("key_responsibilities")
        job.required_skills = result.get("required_skills")
        job.why_interesting = result.get("why_interesting")
        job.language = result.get("language", "fr")
        job.status = JobStatus.analyzed
        db.commit()

        _log(db, task_id, f"✅ Score : {job.fit_score}/10 — {job.fit_reasoning[:80] if job.fit_reasoning else ''}")
        _done(db, task_id, {"fit_score": job.fit_score})

    except Exception as e:
        _fail(db, task_id, traceback.format_exc())
    finally:
        db.close()


def run_generate(task_id: str, user_id: str, job_id: str):
    """Génère CV PDF + lettre de motivation et les upload sur le storage."""
    db = _get_sync_db()
    try:
        from app.models import Task, TaskStatus, Job, JobStatus, User
        import sys, tempfile
        sys.path.insert(0, "/app/shared")

        task = db.query(Task).filter(Task.id == task_id).first()
        task.status = TaskStatus.running
        task.started_at = datetime.utcnow()
        db.commit()

        user = db.query(User).filter(User.id == user_id).first()
        job  = db.query(Job).filter(Job.id == job_id).first()
        api_key = user.anthropic_key or settings.ANTHROPIC_API_KEY

        _log(db, task_id, f"📄 Génération : {job.company} — {job.title}")

        analysis = {
            "job": {"title": job.title, "company": job.company, "url": job.url},
            "fit_score": job.fit_score,
            "fit_reasoning": job.fit_reasoning,
            "role_summary": job.role_summary,
            "key_responsibilities": job.key_responsibilities or [],
            "required_skills": job.required_skills or [],
            "why_interesting": job.why_interesting,
            "language": job.language or "fr",
        }

        # Lettre
        _log(db, task_id, "✍️  Lettre de motivation...")
        from generators.cover_letter import CoverLetterGenerator
        cl_gen = CoverLetterGenerator(api_key=api_key, model=settings.DEFAULT_MODEL)
        letter_text = cl_gen.generate_text(analysis, language=job.language or "fr")

        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
            f.write(letter_text.encode())
            letter_path = f.name

        from app.services.storage import upload_file_sync
        letter_url = upload_file_sync(
            path=letter_path,
            filename=f"users/{user_id}/jobs/{job_id}/lettre.txt",
            content_type="text/plain",
        )
        _log(db, task_id, f"   ✅ Lettre uploadée")

        # CV
        _log(db, task_id, "📎 Génération du CV PDF...")
        from generators.cv_builder import CVBuilder
        cv_gen = CVBuilder(api_key=api_key, model=settings.DEFAULT_MODEL)
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            cv_path = f.name

        cv_gen.generate_and_save(analysis, Path(cv_path))
        cv_url = upload_file_sync(
            path=cv_path,
            filename=f"users/{user_id}/jobs/{job_id}/cv.pdf",
            content_type="application/pdf",
        )
        _log(db, task_id, "   ✅ CV uploadé")

        job.cv_url = cv_url
        job.letter_url = letter_url
        job.status = JobStatus.generated
        db.commit()

        _done(db, task_id, {"cv_url": cv_url, "letter_url": letter_url})

    except Exception as e:
        _fail(db, task_id, traceback.format_exc())
    finally:
        db.close()


def run_autofill(task_id: str, user_id: str, job_id: str):
    """Remplit le formulaire ATS via Playwright."""
    db = _get_sync_db()
    try:
        from app.models import Task, TaskStatus, Job, JobStatus, User
        import sys, tempfile
        sys.path.insert(0, "/app/shared")

        task = db.query(Task).filter(Task.id == task_id).first()
        task.status = TaskStatus.running
        task.started_at = datetime.utcnow()
        db.commit()

        user = db.query(User).filter(User.id == user_id).first()
        job  = db.query(Job).filter(Job.id == job_id).first()
        api_key = user.anthropic_key or settings.ANTHROPIC_API_KEY

        _log(db, task_id, f"🤖 Autofill : {job.company} — {job.title}")

        # Télécharge le CV depuis le storage
        from app.services.storage import download_file_sync
        cv_path = Path(tempfile.mktemp(suffix=".pdf"))
        download_file_sync(job.cv_url, cv_path)

        # Télécharge la lettre
        letter_text = ""
        if job.letter_url:
            letter_path = Path(tempfile.mktemp(suffix=".txt"))
            download_file_sync(job.letter_url, letter_path)
            letter_text = letter_path.read_text(encoding="utf-8")

        # Profile dir isolé par user (pas de collision de session)
        profile_dir = Path(settings.BROWSER_PROFILES_DIR) / str(user_id)
        profile_dir.mkdir(parents=True, exist_ok=True)

        from scrapers.autofill import AutoFiller
        job_dict = {
            "title": job.title, "company": job.company,
            "url": job.url, "description": job.description,
        }

        filler = AutoFiller(headless=True, profile_dir=profile_dir)
        ok = filler.smart_fill(
            job_dict, cv_path, letter_text,
            api_key=api_key,
            model=settings.DEFAULT_MODEL,
            auto_submit=False,
            pause=False,
        )
        filler._close()

        if ok:
            job.autofill_done = True
            job.autofill_answers = filler._auto_submit_message or {}
            job.status = JobStatus.filled
            db.commit()
            _log(db, task_id, "✅ Formulaire rempli — en attente de soumission manuelle")
            _done(db, task_id, {"filled": True})
        else:
            _log(db, task_id, "⚠ Formulaire non rempli (compte requis ou pas de form)")
            _done(db, task_id, {"filled": False, "reason": filler._auto_submit_message})

    except Exception as e:
        _fail(db, task_id, traceback.format_exc())
    finally:
        db.close()


def run_full_pipeline(task_id: str, user_id: str, payload: dict):
    """
    Pipeline complet : scrape → analyze → generate pour les ≥ min_score.
    Chaque step update le progress et les logs.
    """
    db = _get_sync_db()
    try:
        from app.models import Task, TaskStatus, Job, User
        task = db.query(Task).filter(Task.id == task_id).first()
        task.status = TaskStatus.running
        task.started_at = datetime.utcnow()
        db.commit()

        _log(db, task_id, "🚀 Pipeline démarré")

        # Step 1 : Scrape (réutilise run_scrape en inline)
        _log(db, task_id, "\n── Étape 1 : Scraping ──", progress=0)
        run_scrape(task_id, user_id, payload)  # met à jour les offres

        # Step 2 : Analyze les nouvelles offres
        _log(db, task_id, "\n── Étape 2 : Analyse ──", progress=33)
        new_jobs = db.query(Job).filter(
            Job.user_id == user_id, Job.fit_score.is_(None)
        ).all()
        _log(db, task_id, f"{len(new_jobs)} offre(s) à analyser")

        user = db.query(User).filter(User.id == user_id).first()
        api_key = user.anthropic_key or settings.ANTHROPIC_API_KEY

        import sys
        sys.path.insert(0, "/app/shared")
        from generators.analyzer import JobAnalyzer
        from app.models import JobStatus
        analyzer = JobAnalyzer(api_key=api_key, model=settings.ANALYSIS_MODEL)

        for i, job in enumerate(new_jobs):
            try:
                job_dict = {"title": job.title, "company": job.company, "description": job.description, "url": job.url}
                result = analyzer.analyze(job_dict)
                job.fit_score = result.get("fit_score")
                job.fit_reasoning = result.get("fit_reasoning")
                job.role_summary = result.get("role_summary")
                job.key_responsibilities = result.get("key_responsibilities")
                job.required_skills = result.get("required_skills")
                job.language = result.get("language", "fr")
                job.status = JobStatus.analyzed
                _log(db, task_id, f"  [{i+1}/{len(new_jobs)}] {job.company} — {job.fit_score}/10", progress=33 + int(i / len(new_jobs) * 33))
            except Exception as e:
                _log(db, task_id, f"  ⚠ Erreur analyse {job.company}: {str(e)[:80]}")

        db.commit()

        # Step 3 : Generate pour les ≥ min_score
        min_score = payload.get("min_score", 6)
        _log(db, task_id, f"\n── Étape 3 : Génération (score ≥ {min_score}) ──", progress=66)
        good_jobs = [j for j in new_jobs if j.fit_score and j.fit_score >= min_score]
        _log(db, task_id, f"{len(good_jobs)} offre(s) à traiter")

        from generators.cover_letter import CoverLetterGenerator
        from generators.cv_builder import CVBuilder
        from app.services.storage import upload_file_sync
        import tempfile

        cl_gen = CoverLetterGenerator(api_key=api_key, model=settings.DEFAULT_MODEL)
        cv_gen = CVBuilder(api_key=api_key, model=settings.DEFAULT_MODEL)

        for i, job in enumerate(good_jobs):
            try:
                analysis = {
                    "job": {"title": job.title, "company": job.company, "url": job.url},
                    "fit_score": job.fit_score, "role_summary": job.role_summary,
                    "key_responsibilities": job.key_responsibilities or [],
                    "required_skills": job.required_skills or [], "language": job.language or "fr",
                }
                letter = cl_gen.generate_text(analysis, language=job.language or "fr")
                with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
                    f.write(letter.encode()); ltmp = f.name
                lurl = upload_file_sync(ltmp, f"users/{user_id}/jobs/{job.id}/lettre.txt", "text/plain")

                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                    cvtmp = f.name
                cv_gen.generate_and_save(analysis, Path(cvtmp))
                curl = upload_file_sync(cvtmp, f"users/{user_id}/jobs/{job.id}/cv.pdf", "application/pdf")

                job.letter_url = lurl
                job.cv_url = curl
                job.status = JobStatus.generated
                _log(db, task_id, f"  [{i+1}/{len(good_jobs)}] ✅ {job.company}", progress=66 + int(i / len(good_jobs) * 34))
            except Exception as e:
                _log(db, task_id, f"  ⚠ Erreur génération {job.company}: {str(e)[:80]}")

        db.commit()
        _log(db, task_id, f"\n✅ Pipeline terminé — {len(good_jobs)} candidature(s) générée(s)", progress=100)
        _done(db, task_id, {"generated": len(good_jobs)})

    except Exception as e:
        _fail(db, task_id, traceback.format_exc())
    finally:
        db.close()


# ── Scraping helper ────────────────────────────────────────────────────────────

def _scrape_platform(platform: str, query: str, location: str, max_results: int, recent_days: int) -> list:
    import sys
    sys.path.insert(0, "/app/shared")
    if platform == "linkedin":
        from scrapers.linkedin import LinkedInScraper
        s = LinkedInScraper()
        return s.search(query, location=location, max_results=max_results, recent_days=recent_days)
    elif platform == "wttj":
        from scrapers.wttj import WTTJScraper
        s = WTTJScraper()
        return s.search(query, location=location, max_results=max_results, recent_days=recent_days)
    return []
