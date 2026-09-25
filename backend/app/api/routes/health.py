"""健康检查与能力派生（docs/02-架构.md §6.1）。

路由级 API 组装：参数校验 -> 调 service -> 组装统一信封。零业务逻辑。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.config import get_settings
from app.core.errors import envelope
from app.services import privacy_service

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get("/health", summary="存活与子系统状态")
def get_health(db: Session = Depends(get_db)) -> dict:
    probe = privacy_service.probe_state(db)
    caps = privacy_service.capabilities(db)
    data = {
        "status": "ok" if probe.db_available else "degraded",
        "version": get_settings().app_version,
        "subsystems": {
            "db": probe.db_available,
            "vector": probe.vector_available,
            "scheduler": probe.scheduler_available,
            "llm_configured": probe.llm_configured,
        },
        "capabilities": caps,
    }
    return envelope(0, data, "ok")


@router.get("/capabilities", summary="能力矩阵（按当前隐私档位派生）")
@router.get(
    "/meta/capabilities",
    summary="能力矩阵（openapi 兼容别名，与 /capabilities 同源）",
)
def get_capabilities(db: Session = Depends(get_db)) -> dict:
    """③ 类消费点：capabilities 派生，与闸门判定同源（同一 PrivacyPolicy）。"""
    return envelope(0, privacy_service.capabilities(db), "ok")
