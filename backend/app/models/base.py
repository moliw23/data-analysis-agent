"""ORM 基类与公共列 mixin。

通用约定（docs/02-架构.md §8）：
- SQLite；主键统一 TEXT 存 UUID4；
- 所有表含 created_at / updated_at（UTC 存储，响应时转本地）；
- 软删统一 deleted_at（NULL 表示未删）；
- 新增列必须可空或有默认值（MVP 用 create_all + 列检查，不用 Alembic，见 §12 R7）。
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    """统一 UTC 时间（naive，落库口径一致）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_uuid() -> str:
    return str(uuid.uuid4())


class Base(DeclarativeBase):
    """全部 ORM 模型的基类。"""


class UuidPkMixin:
    """TEXT 主键存 UUID4，避免自增 id 被猜。"""

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=new_uuid
    )


class TimestampMixin:
    """创建/更新时间。"""

    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class SoftDeleteMixin:
    """软删标记。本机安全策略禁止文件删除，全部删除一律软删。"""

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
