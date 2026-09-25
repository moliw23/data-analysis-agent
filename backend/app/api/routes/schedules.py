"""调度任务与通知端点（P2-6b，openapi /schedules /notifications 契约）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.repositories import schedule_repo
from app.schemas.common import ok
from app.services import schedule_service

router = APIRouter(prefix="/api/v1/schedules", tags=["schedules"])


@router.get("")
def list_schedules(page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=100),
                   db: Session = Depends(get_db)):
    rows, total = schedule_repo.list_jobs(db, page=page, limit=limit)
    return ok({"items": rows and [schedule_service._job_view(r) for r in rows],
               "total": total, "page": page, "limit": limit,
               "hasMore": page * limit < total})


@router.post("", status_code=201)
def create_schedule(payload: dict, db: Session = Depends(get_db)):
    return ok(schedule_service.create_job(db, payload))


@router.get("/{job_id}")
def get_schedule(job_id: str, db: Session = Depends(get_db)):
    row = schedule_repo.get_job(db, job_id)
    if row is None or row.deleted_at is not None:
        from app.core.errors import NotFoundError
        raise NotFoundError("调度任务不存在")
    return ok(schedule_service._job_view(row))


@router.patch("/{job_id}")
def update_schedule(job_id: str, payload: dict, db: Session = Depends(get_db)):
    return ok(schedule_service.update_job(db, job_id, payload))


@router.delete("/{job_id}")
def delete_schedule(job_id: str, db: Session = Depends(get_db)):
    schedule_service.delete_job(db, job_id)
    return ok({"archived": job_id})


@router.post("/{job_id}/run", status_code=201)
def run_schedule(job_id: str, db: Session = Depends(get_db)):
    return ok(schedule_service.run_job_now(db, job_id, trigger="manual"))


@router.get("/{job_id}/runs")
def list_schedule_runs(job_id: str, page: int = Query(1, ge=1),
                       limit: int = Query(20, ge=1, le=100),
                       db: Session = Depends(get_db)):
    return ok(schedule_service.list_runs(db, job_id, page=page, limit=limit))


# ---------------------------- notifications ----------------------------

notif_router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


@notif_router.get("")
def list_notifications(page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
                       unreadOnly: bool = Query(False, alias="unreadOnly"),
                       db: Session = Depends(get_db)):
    rows, total = schedule_repo.list_notifications(db, page=page, limit=limit, unread_only=unreadOnly)
    items = [{
        "id": r.id, "jobId": r.job_id, "runId": r.run_id, "level": r.level,
        "title": r.title, "body": r.body,
        "read": r.read_at is not None,
        "createdAt": r.created_at.isoformat() + "Z",
    } for r in rows]
    return ok({"items": items, "total": total, "page": page, "limit": limit,
               "hasMore": page * limit < total})


@notif_router.patch("/{notification_id}")
def patch_notification(notification_id: str, payload: dict, db: Session = Depends(get_db)):
    row = schedule_repo.mark_read(db, notification_id)
    if row is None:
        from app.core.errors import NotFoundError
        raise NotFoundError("通知不存在")
    db.commit()
    return ok({"id": row.id, "read": row.read_at is not None})
