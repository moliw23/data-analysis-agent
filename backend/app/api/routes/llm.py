"""LLM 网关端点（docs/02-架构.md §6.2）。

只做 HTTP 装配：参数校验 -> 调 service -> 组装统一信封。
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_local_confirm
from app.core.errors import envelope
from app.schemas.common import page_payload
from app.schemas.llm import (
    LlmChatRequest,
    ProviderCreate,
    ProviderTestRequest,
    ProviderUpdate,
    RoutesUpdate,
)
from app.services import llm_service, provider_service

router = APIRouter(prefix="/api/v1/llm", tags=["llm"])


# ---------------------------- chat ----------------------------
@router.post("/chat", summary="非流式补全（前端 4 钩子的统一入口）")
async def llm_chat(
    payload: LlmChatRequest, db: Session = Depends(get_db)
) -> dict:
    result = await llm_service.chat(db, payload)
    return envelope(0, result, "ok")


# ---------------------------- providers ----------------------------
@router.get("/providers", summary="列出供应商（apiKey 只返回掩码）")
def list_providers(db: Session = Depends(get_db)) -> dict:
    return envelope(0, {"items": provider_service.list_providers(db)}, "ok")


@router.post(
    "/providers",
    status_code=201,
    summary="新增供应商（apiKey 落库前经 Fernet 加密）",
    dependencies=[Depends(require_local_confirm)],
)
def create_provider(
    payload: ProviderCreate, db: Session = Depends(get_db)
) -> dict:
    return envelope(0, provider_service.create_provider(db, payload), "ok")


@router.get("/providers/{provider_id}", summary="供应商详情（掩码）")
def get_provider(provider_id: str, db: Session = Depends(get_db)) -> dict:
    return envelope(0, provider_service.get_provider_view(db, provider_id), "ok")


@router.patch(
    "/providers/{provider_id}",
    summary="更新供应商（apiKey 省略则不改）",
    dependencies=[Depends(require_local_confirm)],
)
@router.put(
    "/providers/{provider_id}",
    include_in_schema=False,
    summary="更新供应商（PUT 别名，与 PATCH 同实现）",
    dependencies=[Depends(require_local_confirm)],
)
def update_provider(
    provider_id: str, payload: ProviderUpdate, db: Session = Depends(get_db)
) -> dict:
    return envelope(0, provider_service.update_provider(db, provider_id, payload), "ok")


@router.delete(
    "/providers/{provider_id}",
    summary="停用供应商（软删并解除路由引用）",
    dependencies=[Depends(require_local_confirm)],
)
def delete_provider(provider_id: str, db: Session = Depends(get_db)) -> dict:
    return envelope(0, provider_service.delete_provider(db, provider_id), "ok")


@router.post("/providers/{provider_id}/test", summary="连通性测试（chat + embeddings）")
async def test_provider(
    provider_id: str,
    payload: ProviderTestRequest | None = None,
    db: Session = Depends(get_db),
) -> dict:
    probes = payload.probe if payload else ["chat", "embeddings"]
    result = await provider_service.test_provider(db, provider_id, probes)
    return envelope(0, result, "ok")


# ---------------------------- routes ----------------------------
@router.get("/routes", summary="查看 taskKey 到模型的路由表")
def get_routes(db: Session = Depends(get_db)) -> dict:
    return envelope(0, {"items": llm_service.get_routes(db)}, "ok")


@router.put(
    "/routes",
    summary="覆盖式更新路由表",
    dependencies=[Depends(require_local_confirm)],
)
def put_routes(payload: RoutesUpdate, db: Session = Depends(get_db)) -> dict:
    updated = llm_service.put_routes(db, payload.items)
    return envelope(0, {"updated": updated}, "ok")


# ---------------------------- logs / stats ----------------------------
@router.get("/logs", summary="调用日志分页")
def list_logs(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=200),
    status: str | None = Query(default=None, pattern="^(ok|error)$"),
    task_key: str | None = Query(default=None, alias="taskKey"),
    provider_id: str | None = Query(default=None, alias="providerId"),
    db: Session = Depends(get_db),
) -> dict:
    items, total = llm_service.list_logs(
        db,
        page=page,
        limit=limit,
        status=status,
        task_key=task_key,
        provider_id=provider_id,
    )
    return envelope(0, page_payload(items, total, page, limit), "ok")


@router.get("/stats", summary="Token 用量统计（按 provider / model / task_key 聚合）")
@router.get("/usage", include_in_schema=False, summary="Token 用量统计（别名）")
def get_stats(
    group_by: str = Query(default="day", alias="groupBy", pattern="^(day|provider|model|task)$"),
    date_from: str | None = Query(default=None, alias="from"),
    date_to: str | None = Query(default=None, alias="to"),
    db: Session = Depends(get_db),
) -> dict:
    return envelope(
        0,
        llm_service.stats(
            db,
            group_by=group_by,
            date_from=_parse_dt(date_from),
            date_to=_parse_dt(date_to),
        ),
        "ok",
    )


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None
