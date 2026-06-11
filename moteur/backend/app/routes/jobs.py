"""
Routes jobs — CRUD + trigger scraping/analyse/génération.
"""
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func
from pydantic import BaseModel

from app.database import get_db
from app.models import User, Job, JobStatus, Task, TaskStatus
from app.core.auth import get_current_user
from app.workers.pipeline import enqueue_scrape, enqueue_analyze, enqueue_generate, enqueue_autofill

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class JobOut(BaseModel):
    id: str
    title: str
    company: str
    location: Optional[str]
    url: str
    platform: str
    fit_score: Optional[int]
    fit_reasoning: Optional[str]
    status: str
    is_seen: bool
    cv_url: Optional[str]
    letter_url: Optional[str]
    autofill_done: bool
    published_at: Optional[str]
    scraped_at: str

    class Config:
        from_attributes = True


class JobUpdateRequest(BaseModel):
    status: Optional[str] = None
    notes: Optional[str] = None
    is_seen: Optional[bool] = None


class ScrapeRequest(BaseModel):
    config_id: Optional[str] = None  # SearchConfig ID, sinon config par défaut
    platforms: list[str] = ["linkedin", "wttj"]
    queries: list[str] = []
    locations: list[str] = ["Paris"]
    max_per_query: int = 10
    recent_days: int = 7


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=list[JobOut])
async def list_jobs(
    status: Optional[str] = Query(None),
    min_score: int = Query(0),
    platform: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = select(Job).where(Job.user_id == user.id, Job.status != JobStatus.deleted)
    if status:
        q = q.where(Job.status == status)
    if min_score > 0:
        q = q.where(Job.fit_score >= min_score)
    if platform:
        q = q.where(Job.platform == platform)
    q = q.order_by(Job.scraped_at.desc()).limit(limit).offset(offset)
    result = await db.execute(q)
    jobs = result.scalars().all()
    return [_job_to_out(j) for j in jobs]


@router.get("/stats")
async def job_stats(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stats rapides pour le dashboard."""
    result = await db.execute(
        select(Job.status, func.count(Job.id))
        .where(Job.user_id == user.id, Job.status != JobStatus.deleted)
        .group_by(Job.status)
    )
    counts = {row[0]: row[1] for row in result}
    total = await db.execute(select(func.count(Job.id)).where(Job.user_id == user.id))
    return {
        "total": total.scalar(),
        "by_status": counts,
        "submitted": counts.get(JobStatus.submitted, 0),
        "interview": counts.get(JobStatus.interview, 0),
        "generated": counts.get(JobStatus.generated, 0),
    }


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await _get_user_job(job_id, user.id, db)
    return _job_to_out(job)


@router.patch("/{job_id}", response_model=JobOut)
async def update_job(
    job_id: UUID,
    data: JobUpdateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await _get_user_job(job_id, user.id, db)
    if data.status is not None:
        job.status = data.status
    if data.notes is not None:
        job.notes = data.notes
    if data.is_seen is not None:
        job.is_seen = data.is_seen
    await db.commit()
    await db.refresh(job)
    return _job_to_out(job)


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await _get_user_job(job_id, user.id, db)
    job.status = JobStatus.deleted
    await db.commit()


# ── Actions / pipeline ─────────────────────────────────────────────────────────

@router.post("/scrape")
async def trigger_scrape(
    data: ScrapeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Lance un scraping en background et retourne l'ID de la tâche."""
    task = Task(
        user_id=user.id,
        type="scrape",
        payload=data.model_dump(),
        status=TaskStatus.pending,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    enqueue_scrape(str(task.id), str(user.id), data.model_dump())
    return {"task_id": str(task.id), "status": "queued"}


@router.post("/{job_id}/analyze")
async def trigger_analyze(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    job = await _get_user_job(job_id, user.id, db)
    task = Task(user_id=user.id, job_id=job.id, type="analyze", status=TaskStatus.pending)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    enqueue_analyze(str(task.id), str(user.id), str(job.id))
    return {"task_id": str(task.id)}


@router.post("/{job_id}/generate")
async def trigger_generate(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Génère CV + lettre pour cette offre."""
    job = await _get_user_job(job_id, user.id, db)
    if not job.fit_score:
        raise HTTPException(400, "Analysez d'abord l'offre avant de générer.")
    task = Task(user_id=user.id, job_id=job.id, type="generate", status=TaskStatus.pending)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    enqueue_generate(str(task.id), str(user.id), str(job.id))
    return {"task_id": str(task.id)}


@router.post("/{job_id}/autofill")
async def trigger_autofill(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Lance le remplissage automatique du formulaire."""
    job = await _get_user_job(job_id, user.id, db)
    if not job.cv_url:
        raise HTTPException(400, "Générez d'abord le CV avant l'autofill.")
    task = Task(user_id=user.id, job_id=job.id, type="autofill", status=TaskStatus.pending)
    db.add(task)
    await db.commit()
    await db.refresh(task)
    enqueue_autofill(str(task.id), str(user.id), str(job.id))
    return {"task_id": str(task.id)}


@router.post("/pipeline")
async def trigger_full_pipeline(
    data: ScrapeRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Lance le pipeline complet : scrape → analyze → generate → autofill."""
    task = Task(
        user_id=user.id,
        type="pipeline",
        payload=data.model_dump(),
        status=TaskStatus.pending,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    from app.workers.pipeline import enqueue_pipeline
    enqueue_pipeline(str(task.id), str(user.id), data.model_dump())
    return {"task_id": str(task.id), "status": "queued"}


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_user_job(job_id: UUID, user_id: UUID, db: AsyncSession) -> Job:
    result = await db.execute(select(Job).where(Job.id == job_id, Job.user_id == user_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Offre introuvable.")
    return job


def _job_to_out(j: Job) -> JobOut:
    return JobOut(
        id=str(j.id),
        title=j.title or "",
        company=j.company or "",
        location=j.location,
        url=j.url or "",
        platform=j.platform or "",
        fit_score=j.fit_score,
        fit_reasoning=j.fit_reasoning,
        status=j.status,
        is_seen=j.is_seen,
        cv_url=j.cv_url,
        letter_url=j.letter_url,
        autofill_done=j.autofill_done,
        published_at=j.published_at.isoformat() if j.published_at else None,
        scraped_at=j.scraped_at.isoformat(),
    )
