"""调度与通知数据访问（只存取；编排/熔断在 services/schedule_service）。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.schedule import Notification, ScheduleJob, ScheduleRun


def get_job(db: Session, job_id: str) -> ScheduleJob | None:
    return db.get(ScheduleJob, job_id)


def list_jobs(db: Session, *, page: int = 1, limit: int = 50,
              enabled_only: bool = False) -> tuple[list[ScheduleJob], int]:
    conds = [ScheduleJob.deleted_at.is_(None)]
    if enabled_only:
        conds.append(ScheduleJob.enabled.is_(True))
    total = db.execute(select(func.count()).select_from(ScheduleJob).where(*conds)).scalar_one()
    stmt = (select(ScheduleJob).where(*conds)
            .order_by(ScheduleJob.created_at.desc())
            .offset((page - 1) * limit).limit(limit))
    return list(db.execute(stmt).scalars().all()), int(total)


def create_job(db: Session, fields: dict[str, Any]) -> ScheduleJob:
    row = ScheduleJob(**fields)
    db.add(row)
    db.flush()
    return row


def soft_delete_job(db: Session, row: ScheduleJob) -> None:
    row.deleted_at = utcnow()
    row.enabled = False
    db.flush()


def create_run(db: Session, fields: dict[str, Any]) -> ScheduleRun:
    row = ScheduleRun(**fields)
    db.add(row)
    db.flush()
    return row


def list_runs(db: Session, job_id: str, *, page: int = 1, limit: int = 20):
    conds = [ScheduleRun.job_id == job_id]
    total = db.execute(select(func.count()).select_from(ScheduleRun).where(*conds)).scalar_one()
    stmt = (select(ScheduleRun).where(*conds)
            .order_by(ScheduleRun.started_at.desc())
            .offset((page - 1) * limit).limit(limit))
    return list(db.execute(stmt).scalars().all()), int(total)


def create_notification(db: Session, fields: dict[str, Any]) -> Notification:
    row = Notification(**fields)
    db.add(row)
    db.flush()
    return row


def list_notifications(db: Session, *, page: int = 1, limit: int = 50,
                       unread_only: bool = False):
    conds = []
    if unread_only:
        conds.append(Notification.read_at.is_(None))
    total = db.execute(select(func.count()).select_from(Notification).where(*conds)).scalar_one()
    stmt = (select(Notification).where(*conds)
            .order_by(Notification.created_at.desc())
            .offset((page - 1) * limit).limit(limit))
    return list(db.execute(stmt).scalars().all()), int(total)


def mark_read(db: Session, notification_id: str) -> Notification | None:
    row = db.get(Notification, notification_id)
    if row is None:
        return None
    if row.read_at is None:
        row.read_at = utcnow()
        db.flush()
    return row
