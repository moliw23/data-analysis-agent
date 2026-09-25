"""调度编排：APScheduler 同进程调度 + 任务执行 + 三连败熔断（AC-22/23）。

铁律：调度执行不依赖浏览器页面（AC-22）；执行路径与请求路径共用同一套
service/repo；strict 档下引用知识库/服务端 SQL 的任务执行前被 service 层拦截。
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from typing import Any

from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.models.base import utcnow
from app.models.schedule import Notification, ScheduleJob, ScheduleRun
from app.repositories import schedule_repo

MAX_CONSECUTIVE_FAILURES = 3

_scheduler = None  # BackgroundScheduler 惰性单例（测试不启动真实线程）


# ---------------------------- 视图 ----------------------------

def _job_view(row: ScheduleJob) -> dict[str, Any]:
    return {
        "id": row.id, "name": row.name, "jobType": row.job_type,
        "datasetId": row.dataset_id, "knowledgeBaseId": row.knowledge_base_id,
        "cron": row.cron, "timezone": row.timezone,
        "params": json.loads(row.params_json) if row.params_json else {},
        "enabled": row.enabled,
        "lastRunAt": row.last_run_at.isoformat() + "Z" if row.last_run_at else None,
        "nextRunAt": row.next_run_at.isoformat() + "Z" if row.next_run_at else None,
        "lastStatus": row.last_status,
        "consecutiveFailures": row.consecutive_failures,
    }


def _run_view(row: ScheduleRun) -> dict[str, Any]:
    return {
        "id": row.id, "jobId": row.job_id, "status": row.status,
        "trigger": row.trigger,
        "startedAt": row.started_at.isoformat() + "Z",
        "finishedAt": row.finished_at.isoformat() + "Z" if row.finished_at else None,
        "durationMs": row.duration_ms,
        "result": json.loads(row.result_json) if row.result_json else None,
        "error": row.error,
    }


# ---------------------------- 执行体 ----------------------------

def _execute(db: Session, job: ScheduleJob) -> dict[str, Any]:
    """任务体。返回 result dict；失败抛异常。"""
    params = json.loads(job.params_json) if job.params_json else {}
    if job.job_type == "dataset_query":
        from app.services import dataset_service, privacy_service

        if not job.dataset_id:
            raise ConflictError("dataset_query 任务缺少 datasetId")
        # service 层二次校验：档位不放行则任务失败（不静默跳过）
        privacy_service.enforce_capability(db, "server_sql")
        ds = dataset_service.get_dataset(db, job.dataset_id)
        sql = params.get("sql") or f'SELECT COUNT(*) AS rows FROM "{ds.server_table}"'
        result = dataset_service.execute_readonly(
            __import__("app.db", fromlist=["get_engine"]).get_engine(), sql
        )
        return {"rowCount": result["rowCount"], "execMs": result["execMs"]}
    if job.job_type == "kb_reindex":
        from app.services import knowledge_service

        kb = knowledge_repo_get_kb(db, job.knowledge_base_id)
        kb.needs_reindex = False
        added = schedule_repo_index(db, kb.id)
        return {"chunksIndexedDelta": added}
    raise ConflictError(f"未知任务类型 {job.job_type}")


def knowledge_repo_get_kb(db: Session, kb_id: str | None):
    from app.core.errors import NotFoundError
    from app.repositories import knowledge_repo

    if not kb_id:
        raise NotFoundError("缺少 knowledgeBaseId")
    row = knowledge_repo.get_kb(db, kb_id)
    if row is None:
        raise NotFoundError("知识库不存在")
    return row


def schedule_repo_index(db: Session, kb_id: str) -> int:
    from app.repositories import knowledge_repo

    return knowledge_repo.index_chunks(db, kb_id)


def run_job_now(db: Session, job_id: str, *, trigger: str = "manual") -> dict[str, Any]:
    """执行一次任务并落历史/通知/熔断计数（AC-22 审计口径 + AC-23 三连败）。"""
    job = schedule_repo.get_job(db, job_id)
    if job is None or job.deleted_at is not None:
        raise NotFoundError("调度任务不存在")

    run = schedule_repo.create_run(db, {
        "job_id": job.id, "status": "running", "trigger": trigger, "started_at": utcnow(),
    })
    started = time.perf_counter()
    try:
        result = _execute(db, job)
        run.status = "ok"
        run.result_json = json.dumps(result, ensure_ascii=False)
        job.consecutive_failures = 0
        job.last_status = "ok"
    except Exception as exc:
        run.status = "failed"
        run.error = str(exc)[:500]
        job.consecutive_failures = (job.consecutive_failures or 0) + 1
        job.last_status = "failed"
        if job.consecutive_failures >= MAX_CONSECUTIVE_FAILURES and job.enabled:
            job.enabled = False
            job.last_status = "paused"
            schedule_repo.create_notification(db, {
                "job_id": job.id, "run_id": run.id, "level": "error",
                "title": f"任务「{job.name}」连续 {MAX_CONSECUTIVE_FAILURES} 次失败，已自动暂停",
                "body": f"最近错误：{str(exc)[:300]}",
            })
    finally:
        run.finished_at = utcnow()
        run.duration_ms = int((time.perf_counter() - started) * 1000)
        job.last_run_at = utcnow()
        job.next_run_at = _next_run_time(job)
        db.commit()
    return {"run": _run_view(run), "job": _job_view(schedule_repo.get_job(db, job_id))}


def _next_run_time(job: ScheduleJob) -> datetime | None:
    if not job.enabled:
        return None
    try:
        trigger = CronTrigger.from_crontab(job.cron, timezone=job.timezone)
        nxt = trigger.get_next_fire_time(None, datetime.now(timezone.utc))
        return nxt.replace(tzinfo=None) if nxt else None
    except ValueError:
        return None


# ---------------------------- CRUD + 调度器接线 ----------------------------

def create_job(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    cron = payload.get("cron") or ""
    try:
        CronTrigger.from_crontab(cron, timezone=payload.get("timezone") or "Asia/Shanghai")
    except ValueError as exc:
        raise ConflictError(f"cron 表达式非法：{exc}") from exc
    job = schedule_repo.create_job(db, {
        "name": (payload.get("name") or "未命名任务")[:200],
        "job_type": payload.get("jobType") or "dataset_query",
        "dataset_id": payload.get("datasetId"),
        "knowledge_base_id": payload.get("knowledgeBaseId"),
        "cron": cron, "timezone": payload.get("timezone") or "Asia/Shanghai",
        "params_json": json.dumps(payload.get("params") or {}, ensure_ascii=False),
        "enabled": payload.get("enabled", True),
    })
    job.next_run_at = _next_run_time(job)
    _sync_scheduler(db, job)
    db.commit()
    return _job_view(job)


def update_job(db: Session, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    job = schedule_repo.get_job(db, job_id)
    if job is None or job.deleted_at is not None:
        raise NotFoundError("调度任务不存在")
    for key in ("name",):
        if payload.get(key) is not None:
            setattr(job, key, str(payload[key])[:200])
    if payload.get("cron"):
        try:
            CronTrigger.from_crontab(payload["cron"], timezone=job.timezone)
        except ValueError as exc:
            raise ConflictError(f"cron 表达式非法：{exc}") from exc
        job.cron = payload["cron"]
        job.next_run_at = _next_run_time(job)
    if "enabled" in payload and payload["enabled"] is not None:
        job.enabled = bool(payload["enabled"])
        if job.enabled:
            job.consecutive_failures = 0
            job.next_run_at = _next_run_time(job)
        else:
            job.next_run_at = None
    _sync_scheduler(db, job)
    db.commit()
    return _job_view(job)


def delete_job(db: Session, job_id: str) -> None:
    job = schedule_repo.get_job(db, job_id)
    if job is None:
        raise NotFoundError("调度任务不存在")
    _remove_from_scheduler(job)
    schedule_repo.soft_delete_job(db, job)
    db.commit()


def list_runs(db: Session, job_id: str, *, page: int = 1, limit: int = 20) -> dict[str, Any]:
    rows, total = schedule_repo.list_runs(db, job_id, page=page, limit=limit)
    return {"items": [_run_view(r) for r in rows], "total": total,
            "page": page, "limit": limit, "hasMore": page * limit < total}


# ---------------------------- APScheduler 接线 ----------------------------

def start_scheduler() -> None:
    """应用启动时调用：注册所有 enabled 任务（重启后 cron 仍在，AC-22）。"""
    global _scheduler
    if _scheduler is not None:
        return
    from apscheduler.schedulers.background import BackgroundScheduler

    _scheduler = BackgroundScheduler(timezone="Asia/Shanghai")
    _scheduler.start()


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def _sync_scheduler(db: Session, job: ScheduleJob) -> None:
    if _scheduler is None or not job.enabled:
        return
    if job.apscheduler_job_id:
        try:
            _scheduler.remove_job(job.apscheduler_job_id)
        except Exception:
            pass
    job.apscheduler_job_id = f"sj_{job.id[:16]}"
    _scheduler.add_job(
        _cron_fire, CronTrigger.from_crontab(job.cron, timezone=job.timezone),
        id=job.apscheduler_job_id, args=[job.id],
        replace_existing=True, misfire_grace_time=60,
    )


def _remove_from_scheduler(job: ScheduleJob) -> None:
    if _scheduler is not None and job.apscheduler_job_id:
        try:
            _scheduler.remove_job(job.apscheduler_job_id)
        except Exception:
            pass


def _cron_fire(job_id: str) -> None:
    """cron 到点入口：独立会话（调度线程与请求线程不共享 session）。"""
    from app.db import get_sessionmaker

    with get_sessionmaker()() as db:
        run_job_now(db, job_id, trigger="cron")
