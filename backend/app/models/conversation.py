"""会话与记忆相关表：conversations / messages / memories（docs/00-Spec §6 表 4-6）。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UuidPkMixin


class Conversation(Base, UuidPkMixin, TimestampMixin, SoftDeleteMixin):
    """会话。删除 = 归档（软删），刷新/换设备后仍在（AC-20）。"""

    __tablename__ = "conversations"

    title: Mapped[str] = mapped_column(String(200), nullable=False, default="新会话")
    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    knowledge_base_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 滚动摘要指针：前 N 条消息已被 summary 覆盖（context 组装跳过它们）
    summarized_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (Index("ix_conversations_archived_updated", "archived_at", "updated_at"),)


class Message(Base, UuidPkMixin, TimestampMixin):
    """消息。会话删除（归档）后消息级联保留（软删模型下不做物理级联）。"""

    __tablename__ = "messages"

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False)  # user/assistant/system/tool
    content: Mapped[str] = mapped_column(Text, nullable=False)
    tool_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tool_payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_call_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    __table_args__ = (Index("ix_messages_conv_created", "conversation_id", "created_at"),)


class Memory(Base, UuidPkMixin, TimestampMixin, SoftDeleteMixin):
    """长期记忆。weight 越高注入优先级越高；expires_at 到期不注入。"""

    __tablename__ = "memories"

    scope: Mapped[str] = mapped_column(String(16), nullable=False)  # global/conversation/dataset
    conversation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    dataset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # fact/preference/insight
    content: Mapped[str] = mapped_column(Text, nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    source_message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (Index("ix_memories_scope_conv_weight", "scope", "conversation_id", "weight"),)
