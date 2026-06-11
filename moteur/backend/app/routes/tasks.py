"""
Routes tasks — statut + logs SSE (Server-Sent Events pour le streaming temps réel).
"""
import asyncio
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db, AsyncSessionLocal
from app.models import User, Task, TaskStatus
from app.core.auth import get_current_user

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("")
async def list_tasks(
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Task)
        .where(Task.user_id == user.id)
        .order_by(Task.created_at.desc())
        .limit(limit)
    )
    tasks = result.scalars().all()
    return [_task_out(t) for t in tasks]


@router.get("/{task_id}")
async def get_task(
    task_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    task = await _get_user_task(task_id, user.id, db)
    return _task_out(task)


@router.get("/{task_id}/stream")
async def stream_task_logs(
    task_id: UUID,
    user: User = Depends(get_current_user),
):
    """
    SSE endpoint — le frontend s'abonne ici pour recevoir les logs temps réel.
    Retourne un event 'done' quand la tâche se termine.
    """
    async def event_generator():
        last_len = 0
        for _ in range(600):  # max 10 min (600 * 1s)
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Task).where(Task.id == task_id, Task.user_id == user.id)
                )
                task = result.scalar_one_or_none()
                if not task:
                    yield "event: error\ndata: Task not found\n\n"
                    return

                # Envoie les nouveaux logs
                log = task.log or ""
                if len(log) > last_len:
                    new_chunk = log[last_len:]
                    last_len = len(log)
                    for line in new_chunk.splitlines():
                        if line.strip():
                            yield f"data: {json.dumps({'log': line, 'progress': task.progress})}\n\n"

                # Terminé ?
                if task.status in (TaskStatus.done, TaskStatus.failed):
                    yield f"event: done\ndata: {json.dumps({'status': task.status, 'result': task.result})}\n\n"
                    return

            await asyncio.sleep(1)

        yield "event: timeout\ndata: stream timeout\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


async def _get_user_task(task_id: UUID, user_id: UUID, db: AsyncSession) -> Task:
    result = await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(404, "Tâche introuvable.")
    return task


def _task_out(t: Task) -> dict:
    return {
        "id": str(t.id),
        "type": t.type,
        "status": t.status,
        "progress": t.progress,
        "job_id": str(t.job_id) if t.job_id else None,
        "result": t.result,
        "created_at": t.created_at.isoformat(),
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "finished_at": t.finished_at.isoformat() if t.finished_at else None,
    }
