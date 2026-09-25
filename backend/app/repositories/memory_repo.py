"""长期记忆数据访问（分层规范：只存取；注入策略在 services/conversation_service）。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.conversation import Memory
from app.models.settings import AppSetting

MEMORY_ENABLED_KEY = "memory_enabled"


def list_memories(
    db: Session,
    *,
    page: int = 1,
    limit: int = 50,
    scope: str | None = None,
    conversation_id: str | None = None,
    kind: str | None = None,
) -> tuple[list[Memory], int]:
    conds = [Memory.deleted_at.is_(None)]
    if scope:
        conds.append(Memory.scope == scope)
    if conversation_id:
        conds.append(Memory.conversation_id == conversation_id)
    if kind:
        conds.append(Memory.kind == kind)
    total = db.execute(select(func.count()).select_from(Memory).where(*conds)).scalar_one()
    stmt = (
        select(Memory)
        .where(*conds)
        .order_by(Memory.weight.desc(), Memory.updated_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all()), int(total)


def create_memory(db: Session, fields: dict[str, Any]) -> Memory:
    row = Memory(**fields)
    db.add(row)
    db.flush()
    return row


def update_memory(db: Session, row: Memory, fields: dict[str, Any]) -> Memory:
    for key, value in fields.items():
        setattr(row, key, value)
    db.flush()
    return row


def delete_memory(db: Session, row: Memory) -> None:
    row.deleted_at = utcnow()
    db.flush()


def memories_for_injection(db: Session, *, conversation_id: str | None) -> list[Memory]:
    """取可注入记忆：未删、未过期；global 恒可注入，conversation 限定本会话。

    排序 weight DESC（仓储层不实现预算裁剪——那是 service 的编排职责）。
    """
    now = utcnow()
    conds = [
        Memory.deleted_at.is_(None),
        (Memory.expires_at.is_(None)) | (Memory.expires_at > now),
    ]
    if conversation_id:
        conds.append(
            (Memory.scope == "global")
            | ((Memory.scope == "conversation") & (Memory.conversation_id == conversation_id))
        )
    else:
        conds.append(Memory.scope == "global")
    stmt = select(Memory).where(*conds).order_by(Memory.weight.desc())
    return list(db.execute(stmt).scalars().all())


def is_memory_enabled(db: Session, default: bool = True) -> bool:
    row = db.get(AppSetting, MEMORY_ENABLED_KEY)
    if row is None:
        return default
    import json

    try:
        return bool(json.loads(row.value_json))
    except (TypeError, json.JSONDecodeError):
        return default


def set_memory_enabled(db: Session, enabled: bool) -> None:
    from app.repositories.settings_repo import set_setting

    set_setting(db, MEMORY_ENABLED_KEY, bool(enabled))
