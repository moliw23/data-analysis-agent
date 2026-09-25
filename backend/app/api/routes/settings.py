"""系统设置与隐私档位（docs/02-架构.md §6.8）——F0 档位的唯一管理入口。"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_local_confirm
from app.core.errors import envelope
from app.schemas.settings import PrivacyModeUpdate
from app.services import privacy_service

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.get("/privacy-mode", summary="读取当前隐私档位及其生效边界")
def get_privacy_mode(db: Session = Depends(get_db)) -> dict:
    return envelope(0, privacy_service.status(db), "ok")


@router.put(
    "/privacy-mode",
    summary="切换隐私档位（接口层强制生效）",
    dependencies=[Depends(require_local_confirm)],
)
def put_privacy_mode(
    payload: PrivacyModeUpdate, db: Session = Depends(get_db)
) -> dict:
    mode = privacy_service.set_privacy_mode(db, payload.privacy_mode.value)
    return envelope(0, privacy_service.status(db), f"隐私档位已切换为 {mode}")


@router.get("", summary="全部设置只读聚合")
@router.get("/", include_in_schema=False)
def get_settings_overview(db: Session = Depends(get_db)) -> dict:
    return envelope(0, privacy_service.overview(db), "ok")


@router.put("/memory-switch", summary="记忆总开关（AC-21：关闭后 context 零注入）",
            dependencies=[Depends(require_local_confirm)])
def put_memory_switch(payload: dict, db: Session = Depends(get_db)) -> dict:
    from app.repositories import memory_repo

    enabled = bool(payload.get("enabled", True))
    memory_repo.set_memory_enabled(db, enabled)
    db.commit()
    return envelope(0, {"enabled": enabled}, "记忆开关已更新")
