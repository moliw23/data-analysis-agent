"""LLM 数据访问：provider / route / call log 的纯存取。

本文件只做存取，不含业务分支（允许 `if row is None: return None` 这类存取判断）。
路由选择、fallback、熔断等业务逻辑在 services/llm_service.py。

关键取数口径（Spec §6.1，写在此处防各处口径不一）：
- Token 用量仅统计 status='ok' 且有 usage 的记录；
- SUM() 天然区分 NULL 与 0：全部为 NULL 时 SUM 返回 NULL（未知），
  混有 0 时返回 0（确实为 0）。
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.llm import LlmCallLog, LlmProvider, LlmRoute


# ---------------------------- providers ----------------------------
def list_providers(db: Session, *, include_inactive: bool = True) -> list[LlmProvider]:
    stmt = select(LlmProvider).where(LlmProvider.deleted_at.is_(None))
    if not include_inactive:
        stmt = stmt.where(LlmProvider.is_active.is_(True))
    stmt = stmt.order_by(LlmProvider.created_at.asc())
    return list(db.execute(stmt).scalars().all())


def get_provider(db: Session, provider_id: str) -> LlmProvider | None:
    stmt = select(LlmProvider).where(
        LlmProvider.id == provider_id, LlmProvider.deleted_at.is_(None)
    )
    return db.execute(stmt).scalar_one_or_none()


def get_provider_by_name(db: Session, name: str) -> LlmProvider | None:
    stmt = select(LlmProvider).where(
        LlmProvider.name == name, LlmProvider.deleted_at.is_(None)
    )
    return db.execute(stmt).scalar_one_or_none()


def create_provider(db: Session, fields: dict[str, Any]) -> LlmProvider:
    row = LlmProvider(**fields)
    db.add(row)
    db.flush()
    return row


def update_provider(db: Session, row: LlmProvider, fields: dict[str, Any]) -> LlmProvider:
    for key, value in fields.items():
        setattr(row, key, value)
    db.flush()
    return row


def soft_delete_provider(db: Session, row: LlmProvider) -> None:
    row.is_active = False
    row.deleted_at = utcnow()
    db.flush()


# ---------------------------- routes ----------------------------
def list_routes(db: Session) -> list[LlmRoute]:
    stmt = select(LlmRoute).order_by(LlmRoute.task_key.asc())
    return list(db.execute(stmt).scalars().all())


def get_route(db: Session, task_key: str) -> LlmRoute | None:
    stmt = select(LlmRoute).where(LlmRoute.task_key == task_key)
    return db.execute(stmt).scalar_one_or_none()


def upsert_route(
    db: Session,
    task_key: str,
    primary_provider_id: str | None,
    primary_model: str | None,
    fallback: list[dict[str, Any]] | None = None,
) -> LlmRoute:
    row = get_route(db, task_key)
    payload = json.dumps(fallback or [], ensure_ascii=False)
    if row is None:
        row = LlmRoute(
            task_key=task_key,
            primary_provider_id=primary_provider_id,
            primary_model=primary_model,
            fallback_json=payload,
        )
        db.add(row)
    else:
        row.primary_provider_id = primary_provider_id
        row.primary_model = primary_model
        row.fallback_json = payload
    db.flush()
    return row


def detach_provider_from_routes(db: Session, provider_id: str) -> int:
    """软删 provider 时解除路由引用（清 primary，并从 fallback 中剔除）。"""
    changed = 0
    for row in list_routes(db):
        touched = False
        if row.primary_provider_id == provider_id:
            row.primary_provider_id = None
            row.primary_model = None
            touched = True
        try:
            items = json.loads(row.fallback_json or "[]")
        except json.JSONDecodeError:
            items = []
        kept = [i for i in items if i.get("providerId") != provider_id]
        if len(kept) != len(items):
            row.fallback_json = json.dumps(kept, ensure_ascii=False)
            touched = True
        if touched:
            changed += 1
    db.flush()
    return changed


# ---------------------------- call logs ----------------------------
def create_log(db: Session, fields: dict[str, Any]) -> LlmCallLog:
    row = LlmCallLog(created_at=utcnow(), **fields)
    db.add(row)
    db.flush()
    return row


def list_logs(
    db: Session,
    *,
    page: int = 1,
    limit: int = 20,
    status: str | None = None,
    task_key: str | None = None,
    provider_id: str | None = None,
) -> tuple[list[LlmCallLog], int]:
    conds = []
    if status:
        conds.append(LlmCallLog.status == status)
    if task_key:
        conds.append(LlmCallLog.task_key == task_key)
    if provider_id:
        conds.append(LlmCallLog.provider_id == provider_id)

    total = db.execute(
        select(func.count()).select_from(LlmCallLog).where(*conds)
    ).scalar_one()
    stmt = (
        select(LlmCallLog)
        .where(*conds)
        .order_by(LlmCallLog.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    return list(db.execute(stmt).scalars().all()), int(total)


_USAGE_GROUP_EXPR: dict[str, Any] = {
    "day": func.date(LlmCallLog.created_at),
    "provider": LlmCallLog.provider_id,
    "model": LlmCallLog.model,
    "task": LlmCallLog.task_key,
}


def aggregate_usage(
    db: Session,
    *,
    group_by: str = "day",
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[dict[str, Any]]:
    """Token 用量聚合。仅 status='ok' 且至少一个 token 字段非 NULL 的记录。"""
    expr = _USAGE_GROUP_EXPR.get(group_by, _USAGE_GROUP_EXPR["day"])
    conds = [
        LlmCallLog.status == "ok",
        (
            LlmCallLog.prompt_tokens.is_not(None)
            | LlmCallLog.completion_tokens.is_not(None)
            | LlmCallLog.total_tokens.is_not(None)
        ),
    ]
    if date_from is not None:
        conds.append(LlmCallLog.created_at >= date_from)
    if date_to is not None:
        conds.append(LlmCallLog.created_at <= date_to)

    stmt = (
        select(
            expr.label("key"),
            func.sum(LlmCallLog.prompt_tokens).label("prompt_tokens"),
            func.sum(LlmCallLog.completion_tokens).label("completion_tokens"),
            func.sum(LlmCallLog.total_tokens).label("total_tokens"),
            func.count().label("calls"),
        )
        .where(*conds)
        .group_by(expr)
        .order_by(func.count().desc())
    )
    out: list[dict[str, Any]] = []
    for row in db.execute(stmt).all():
        out.append(
            {
                "key": str(row.key) if row.key is not None else "unknown",
                "promptTokens": row.prompt_tokens,
                "completionTokens": row.completion_tokens,
                "totalTokens": row.total_tokens,
                "calls": int(row.calls),
            }
        )
    return out
