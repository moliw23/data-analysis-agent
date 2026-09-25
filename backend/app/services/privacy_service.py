"""F0 隐私档位业务逻辑：档位读写 + capabilities 派生 + 被阻断数据计数。

本模块不含任何 fastapi.Request/Response（分层硬规则）。
所有档位判定委托 core/privacy.py::PrivacyPolicy，禁止在此比较档位字符串。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.privacy import (
    PRIVACY_MODES,
    PrivacyPolicy,
    ProbeState,
    normalize_mode,
)
from app.repositories import llm_repo, settings_repo

logger = logging.getLogger("app.privacy")

SETTING_KEY = "privacy_mode"
# 档位变更历史（只读列表，P1；仅存本地，不上报）
HISTORY_KEY = "privacy_mode_history"
_HISTORY_MAX = 50


def get_privacy_mode(db: Session) -> str:
    """当前档位：app_settings 优先，缺失回落环境变量默认（strict）。"""
    stored = settings_repo.get_json(db, SETTING_KEY)
    if stored in PRIVACY_MODES:
        return stored
    return normalize_mode(get_settings().privacy_mode)


def get_policy(db: Session) -> PrivacyPolicy:
    """当前档位对应的策略对象（三类消费点共用）。"""
    return PrivacyPolicy(get_privacy_mode(db))


def set_privacy_mode(db: Session, mode: str) -> str:
    """切换档位并落库。降级不删除任何既有数据（仅阻断后续访问）。"""
    normalized = normalize_mode(mode)
    previous = get_privacy_mode(db)
    settings_repo.set_setting(db, SETTING_KEY, normalized)
    _append_history(db, previous, normalized)
    db.commit()
    logger.info("privacy_mode changed: %s -> %s", previous, normalized)
    return normalized


def _append_history(db: Session, previous: str, current: str) -> None:
    history = settings_repo.get_json(db, HISTORY_KEY) or []
    if not isinstance(history, list):
        history = []
    from app.models.base import utcnow

    history.append(
        {"from": previous, "to": current, "at": utcnow().isoformat() + "Z"}
    )
    settings_repo.set_setting(db, HISTORY_KEY, history[-_HISTORY_MAX:])


def get_history(db: Session) -> list[dict[str, Any]]:
    history = settings_repo.get_json(db, HISTORY_KEY) or []
    return history if isinstance(history, list) else []


def privacy_updated_at(db: Session) -> Any:
    row = settings_repo.get_setting(db, SETTING_KEY)
    return row.updated_at if row is not None else None


# ---------------------------- 被阻断数据计数 ----------------------------
def blocked_counts(db: Session, mode: str | None = None) -> dict[str, int]:
    """仅统计因当前档位而不可访问的既有数据；降级不删除数据，故计数持续存在。"""
    policy = PrivacyPolicy(mode) if mode else get_policy(db)
    counts = {"server_datasets": 0, "knowledge_bases": 0, "kb_documents": 0}
    if not policy.allows_server_dataset_register():
        counts["server_datasets"] = settings_repo.count_where(
            db, "datasets", "storage_mode = 'server' AND deleted_at IS NULL"
        )
    if not policy.allows_kb_ingest():
        counts["knowledge_bases"] = settings_repo.count_where(
            db, "knowledge_bases", "deleted_at IS NULL"
        )
        counts["kb_documents"] = settings_repo.count_where(
            db, "kb_documents", "deleted_at IS NULL"
        )
    return counts


# ---------------------------- 真实探测 ----------------------------
def vector_available() -> bool:
    """chromadb 是否可用（本波未安装 RAG 依赖，预期 False）。"""
    try:
        import chromadb  # noqa: F401

        return True
    except Exception:
        return False


def embeddings_available(db: Session) -> bool:
    """是否有 provider 曾被探针证实支持 embeddings。"""
    if not settings_repo.table_exists(db, "embedding_probes"):
        return False
    return (
        settings_repo.count_where(db, "embedding_probes", "ok = 1") > 0
    )


def probe_state(db: Session) -> ProbeState:
    from app.db import check_db

    return ProbeState(
        db_available=check_db(),
        vector_available=vector_available(),
        embeddings_available=embeddings_available(db),
        scheduler_available=False,  # 调度器为后续波次，勿谎报 True
        llm_configured=len(llm_repo.list_providers(db, include_inactive=False)) > 0,
    )


def capabilities(db: Session) -> dict[str, Any]:
    """③ 能力声明派生 —— 与闸门判定同源（同一 PrivacyPolicy 对象）。"""
    policy = get_policy(db)
    return policy.derive_capabilities(probe_state(db))


def effective_grants(db: Session) -> dict[str, bool]:
    """当前档位实际放行的能力（前端据此渲染，不自行推断）。"""
    policy = get_policy(db)
    return {
        "llm_proxy": True,
        "conversation_persistence": True,
        "kb_ingest": policy.allows_kb_ingest(),
        "kb_search": policy.allows_kb_search(),
        "server_sql": policy.allows_server_sql(),
        "external_db_proxy": policy.allows_external_db(),
    }


def enforce_capability(db: Session, capability: str) -> None:
    """② 请求体级闸门：当同一端点因 body 字段值不同而判定不同时调用。

    例：POST /datasets 的 storageMode='server'。路由级 dependency 无法按 body 有条件放行，
    故在此按字段值二次校验（与路由级闸门共用同一 PrivacyPolicy 与 4030 载荷）。
    """
    policy = get_policy(db)
    policy.raise_if_blocked(capability, blocked_counts(db, policy.mode))


def status(db: Session) -> dict[str, Any]:
    """GET/PUT /settings/privacy-mode 的响应载荷。"""
    mode = get_privacy_mode(db)
    updated = privacy_updated_at(db)
    return {
        "privacy_mode": mode,
        "effective_grants": effective_grants(db),
        "blocked_by_downgrade": blocked_counts(db, mode),
        "updated_at": updated.isoformat() + "Z" if updated else None,
    }


def overview(db: Session) -> dict[str, Any]:
    """GET /api/v1/settings 只读聚合。"""
    providers = llm_repo.list_providers(db)
    routes = llm_repo.list_routes(db)
    payload = status(db)
    payload["history"] = get_history(db)
    payload["llm"] = {
        "providers_total": len(providers),
        "providers_active": sum(1 for p in providers if p.is_active),
        "routes_configured": len(routes),
        "configured": any(p.is_active for p in providers),
    }
    payload["settings"] = settings_repo.get_all(db)
    return payload
