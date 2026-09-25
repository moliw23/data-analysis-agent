"""隐私档位与能力派生的请求/响应模型。

档位枚举由 core/privacy.py::PRIVACY_MODES 动态生成 —— 避免出现第二份档位真相。
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from app.core.privacy import PRIVACY_MODES

# 由唯一档位定义动态生成，禁止在此手写档位字面量
PrivacyMode = Enum("PrivacyMode", {m: m for m in PRIVACY_MODES}, type=str)


class PrivacyModeUpdate(BaseModel):
    privacy_mode: PrivacyMode  # type: ignore[valid-type]


class EffectiveGrants(BaseModel):
    """当前档位实际放行的能力（前端据此渲染，不自行推断）。"""

    llm_proxy: bool = True
    conversation_persistence: bool = True
    kb_ingest: bool = False
    kb_search: bool = False
    server_sql: bool = False
    external_db_proxy: bool = True


class BlockedCounts(BaseModel):
    """因当前档位被阻断访问的既有数据计数。字段恒存在，无数据时为 0。"""

    server_datasets: int = 0
    knowledge_bases: int = 0
    kb_documents: int = 0


class PrivacyModeStatus(BaseModel):
    privacy_mode: PrivacyMode  # type: ignore[valid-type]
    effective_grants: EffectiveGrants
    blocked_by_downgrade: BlockedCounts
    updated_at: datetime | None = None


class RagCapability(BaseModel):
    enabled: bool = False
    ingest_allowed: bool = False
    search_allowed: bool = False
    vector_available: bool = False
    semantic_search: bool = False


class DatasetCapability(BaseModel):
    local_storage_allowed: bool = True
    server_storage_allowed: bool = False
    server_sql_allowed: bool = False


class KnowledgeCapability(BaseModel):
    ingest_allowed: bool = False
    search_allowed: bool = False


class EmbeddingCapability(BaseModel):
    available: bool = False
    probed: bool = False


class Capabilities(BaseModel):
    """能力矩阵。必须由 PrivacyPolicy.derive_capabilities() 派生，与闸门同源。"""

    privacy_mode: PrivacyMode  # type: ignore[valid-type]
    llm_proxy: bool = True
    conversation_persistence: bool = True
    external_db_proxy: bool = True
    rag: RagCapability = Field(default_factory=RagCapability)
    dataset: DatasetCapability = Field(default_factory=DatasetCapability)
    knowledge: KnowledgeCapability = Field(default_factory=KnowledgeCapability)
    embedding: EmbeddingCapability = Field(default_factory=EmbeddingCapability)
    scheduler: bool = False
    # 扁平别名（openapi Capabilities 字段）
    rag_enabled: bool = False
    semantic_search: bool = False
    embeddings_available: bool = False
    server_sql: bool = False


class HealthSubsystems(BaseModel):
    db: bool = False
    vector: bool = False
    scheduler: bool = False
    llm_configured: bool = False


class HealthData(BaseModel):
    status: str = "ok"
    version: str = "1.0.0"
    subsystems: HealthSubsystems = Field(default_factory=HealthSubsystems)
    capabilities: Capabilities | None = None


class SettingsOverview(BaseModel):
    """GET /api/v1/settings 的只读聚合。"""

    privacy_mode: PrivacyMode  # type: ignore[valid-type]
    effective_grants: EffectiveGrants
    blocked_by_downgrade: BlockedCounts
    llm: dict[str, Any] = Field(default_factory=dict)
    settings: list[dict[str, Any]] = Field(default_factory=list)
