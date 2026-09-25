"""数据集与服务端 SQL 表：datasets / dataset_queries（Spec §6 表 12-13）。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UuidPkMixin, utcnow


class Dataset(Base, UuidPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "datasets"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="upload")  # upload/db_proxy
    storage_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="server")  # local/server
    server_table: Mapped[str | None] = mapped_column(String(100), nullable=True)  # ds_<uuid8>
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    column_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    schema_json: Mapped[str | None] = mapped_column(Text, nullable=True)  # [{name,type}]
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    __table_args__ = (
        Index("ix_datasets_sha", "sha256"),
        Index("ix_datasets_storage", "storage_mode"),
    )


class DatasetQuery(Base, UuidPkMixin):
    """服务端 SQL 执行审计（含被拦截的语句）。"""

    __tablename__ = "dataset_queries"

    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    sql_text: Mapped[str] = mapped_column(Text, nullable=False)
    sql_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    truncated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0/1
    exec_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")  # ok/blocked/error
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True, default=utcnow
    )

    __table_args__ = (Index("ix_dsquery_ds_created", "dataset_id", "created_at"),)
