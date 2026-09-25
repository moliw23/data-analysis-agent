"""会话与消息数据访问（分层规范：只存取，业务编排在 services/conversation_service）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.conversation import Conversation, Message


def get_conversation(db: Session, conversation_id: str) -> Conversation | None:
    row = db.get(Conversation, conversation_id)
    if row is None or row.deleted_at is not None:
        return None
    return row


def list_conversations(
    db: Session,
    *,
    page: int = 1,
    limit: int = 20,
    archived: bool = False,
) -> tuple[list[Conversation], int]:
    """未归档列表按 updated_at 倒序；archived=True 时只看已归档（deleted_at 非空）。"""
    if archived:
        conds = [Conversation.deleted_at.is_not(None)]
    else:
        conds = [Conversation.deleted_at.is_(None)]
    total = db.execute(
        select(func.count()).select_from(Conversation).where(*conds)
    ).scalar_one()
    stmt = (
        select(Conversation)
        .where(*conds)
        .order_by(Conversation.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all()), int(total)


def create_conversation(db: Session, fields: dict[str, Any]) -> Conversation:
    row = Conversation(**fields)
    db.add(row)
    db.flush()
    return row


def update_conversation(
    db: Session, row: Conversation, fields: dict[str, Any]
) -> Conversation:
    for key, value in fields.items():
        setattr(row, key, value)
    db.flush()
    return row


def archive_conversation(db: Session, row: Conversation) -> None:
    """归档 = 软删：deleted_at 与 archived_at 同步置位。"""
    now = utcnow()
    row.deleted_at = now
    row.archived_at = now
    db.flush()


def list_messages(
    db: Session,
    conversation_id: str,
    *,
    page: int = 1,
    limit: int = 50,
) -> tuple[list[Message], int]:
    """消息分页，created_at 倒序（最新在前，与契约一致）。"""
    conds = [Message.conversation_id == conversation_id]
    total = db.execute(
        select(func.count()).select_from(Message).where(*conds)
    ).scalar_one()
    stmt = (
        select(Message)
        .where(*conds)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all()), int(total)


def list_messages_asc(db: Session, conversation_id: str) -> list[Message]:
    """正序全量（上下文组装 / 摘要用）。"""
    stmt = (
        select(Message)
        .where(Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc(), Message.id.asc())
    )
    return list(db.execute(stmt).scalars().all())


def count_messages(db: Session, conversation_id: str) -> int:
    return int(
        db.execute(
            select(func.count())
            .select_from(Message)
            .where(Message.conversation_id == conversation_id)
        ).scalar_one()
    )


def create_message(db: Session, fields: dict[str, Any]) -> Message:
    row = Message(**fields)
    db.add(row)
    db.flush()
    return row


def delete_message(db: Session, row: Message) -> None:
    """消息删除是物理删除（软删表约定只对聚合根生效），条数同步回写会话。"""
    db.delete(row)
    db.flush()


def bump_message_count(db: Session, conversation_id: str, delta: int) -> int:
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        return 0
    conv.message_count = max(0, (conv.message_count or 0) + delta)
    conv.updated_at = utcnow()
    db.flush()
    return conv.message_count


def set_summary(db: Session, conversation_id: str, summary: str, summarized_count: int) -> None:
    """滚动摘要落库：summary 覆盖前 summarized_count 条消息（指针随摘要推进）。"""
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        return
    conv.summary = summary
    conv.summarized_count = max(0, int(summarized_count))
    db.flush()
