"""系统设置相关表：app_settings / feature_flags / embedding_probes。

app_settings 是 privacy_mode 的持久化位置（键值 JSON）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, utcnow


class AppSetting(Base):
    """键值配置。privacy_mode 的持久化落点。"""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False, default="null")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )


class FeatureFlag(Base):
    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rollouts_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow, onupdate=utcnow
    )


class EmbeddingProbe(Base):
    """embeddings 探针结果缓存，避免每次检索前都探测（R2 / R6）。"""

    __tablename__ = "embedding_probes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider_id: Mapped[str] = mapped_column(String(36), nullable=False)
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    dim: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ok: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, default=utcnow
    )

    __table_args__ = (
        Index("ix_embedding_probes_provider_checked", "provider_id", "checked_at"),
    )
