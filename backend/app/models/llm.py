"""LLM 网关相关表：llm_providers / llm_routes / llm_call_logs（docs/02-架构.md §8.1）。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UuidPkMixin


class LlmProvider(Base, UuidPkMixin, TimestampMixin, SoftDeleteMixin):
    """供应商。api_key 只写不读：落库为 Fernet 密文，对外只暴露 api_key_hint。"""

    __tablename__ = "llm_providers"

    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    api_key_enc: Mapped[str] = mapped_column(Text, nullable=False)
    api_key_hint: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    default_model: Mapped[str] = mapped_column(String(200), nullable=False)
    embeddings_supported: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    __table_args__ = (Index("ix_llm_providers_is_active", "is_active"),)


class LlmRoute(Base, UuidPkMixin, TimestampMixin):
    """按 task_key 的路由表。fallback 存 JSON 数组字符串。"""

    __tablename__ = "llm_routes"

    task_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    primary_provider_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    primary_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    fallback_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")


class LlmCallLog(Base, UuidPkMixin):
    """调用日志。主 provider 失败时 fallback 的两次尝试都要落一条记录（AC-04）。

    token 字段可空：上游未返回 usage 时写 NULL 而非 0
    （NULL = 未知，0 = 确实为 0，语义必须区分，见 Spec §6.1）。
    """

    __tablename__ = "llm_call_logs"

    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    task_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="ok")
    error_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, index=True
    )

    __table_args__ = (
        Index("ix_llm_call_logs_provider_created", "provider_id", "created_at"),
        Index("ix_llm_call_logs_task_created", "task_key", "created_at"),
        Index("ix_llm_call_logs_conversation", "conversation_id"),
    )
