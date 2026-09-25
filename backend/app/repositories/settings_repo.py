"""系统设置数据访问：app_settings 键值读写 + 被阻断数据计数。

被阻断计数使用表存在性探测：后续波次新增 datasets / knowledge_bases / kb_documents
表后自动开始计数，本波返回 0（如实反映"当前确无此类数据"）。
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.models.settings import AppSetting


def get_setting(db: Session, key: str) -> AppSetting | None:
    return db.get(AppSetting, key)


def set_setting(db: Session, key: str, value: Any) -> AppSetting:
    payload = json.dumps(value, ensure_ascii=False)
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value_json=payload)
        db.add(row)
    else:
        row.value_json = payload
    db.flush()
    return row


def get_json(db: Session, key: str, default: Any = None) -> Any:
    row = get_setting(db, key)
    if row is None:
        return default
    try:
        return json.loads(row.value_json)
    except (TypeError, json.JSONDecodeError):
        return default


def get_all(db: Session) -> list[dict[str, Any]]:
    stmt = select(AppSetting).order_by(AppSetting.key.asc())
    return [
        {
            "key": r.key,
            "value": _safe_json(r.value_json),
            "updated_at": r.updated_at,
        }
        for r in db.execute(stmt).scalars().all()
    ]


def _safe_json(raw: str) -> Any:
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw


def table_exists(db: Session, table_name: str) -> bool:
    return table_name in inspect(db.get_bind()).get_table_names()


def count_where(db: Session, table_name: str, where_sql: str = "") -> int:
    """对可能尚不存在的表做计数；表不存在返回 0（不抛错）。"""
    if not table_exists(db, table_name):
        return 0
    sql = f'SELECT COUNT(*) FROM "{table_name}"'
    if where_sql:
        sql += f" WHERE {where_sql}"
    try:
        return int(db.execute(text(sql)).scalar_one())
    except Exception:
        return 0


__all__ = [
    "count_where",
    "get_all",
    "get_json",
    "get_setting",
    "set_setting",
    "table_exists",
]
