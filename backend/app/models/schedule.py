"""调度与通知表：schedule_jobs / schedule_runs / notifications（Spec §6 表 14-16）。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UuidPkMixin


class ScheduleJob(Base, UuidPkMixin, TimestampMixin, SoftDeleteMixin):
    """调度任务。cron 触发由同进程 APScheduler 执行（AC-22：关页面照常执行）。"""

    __tablename__ = "schedule_jobs"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    job_type: Mapped[str] = mapped_column(String(32), nullable=False)  # dataset_query / kb_reindex
    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    knowledge_base_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    cron: Mapped[str] = mapped_column(String(64), nullable=False)  # 5 段 crontab
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Shanghai")
    params_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # {sql} 等
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    apscheduler_job_id: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(16), nullable=True)  # ok/failed/paused
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (Index("ix_sjob_enabled_next", "enabled", "next_run_at"),)


class ScheduleRun(Base, UuidPkMixin):
    """运行历史：状态/耗时/行数/错误（AC-22 审计口径）。"""

    __tablename__ = "schedule_runs"

    job_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)  # running/ok/failed
    trigger: Mapped[str] = mapped_column(String(16), nullable=False, default="cron")  # cron/manual
    started_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_srun_job_started", "job_id", "started_at"),)


class Notification(Base, UuidPkMixin, TimestampMixin):
    __tablename__ = "notifications"

    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="info")  # info/warn/error
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (Index("ix_notif_read_created", "read_at", "created_at"),)
