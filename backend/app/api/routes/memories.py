"""长期记忆端点：列表/写入/修改/删除（P2-4，openapi 686-780 行）。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.common import ok
from app.services import conversation_service

router = APIRouter(prefix="/api/v1/memories", tags=["memories"])


class MemoryCreate(BaseModel):
    """openapi MemoryCreate 契约镜像。"""

    scope: Literal["global", "conversation", "dataset"]
    conversationId: str | None = None
    datasetId: str | None = None
    kind: Literal["fact", "preference", "insight"]
    content: str = Field(min_length=1, max_length=4000)
    weight: float = Field(default=1.0, ge=0, le=10)


class MemoryUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=4000)
    weight: float | None = Field(default=None, ge=0, le=10)
    expiresAt: datetime | None = None


@router.get("")
def list_memories(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    scope: str | None = Query(None, pattern="^(global|conversation|dataset)$"),
    conversationId: str | None = Query(None, alias="conversationId"),
    kind: str | None = Query(None, pattern="^(fact|preference|insight)$"),
    db: Session = Depends(get_db),
):
    return ok(conversation_service.list_memories(
        db, page=page, limit=limit, scope=scope, conversation_id=conversationId, kind=kind
    ))


@router.post("", status_code=201)
def create_memory(payload: MemoryCreate, db: Session = Depends(get_db)):
    data = payload.model_dump(by_alias=True)
    if data.get("expiresAt"):
        data["expiresAt"] = data["expiresAt"].isoformat()
    return ok(conversation_service.create_memory(db, data))


@router.patch("/{memory_id}")
def update_memory(memory_id: str, payload: MemoryUpdate, db: Session = Depends(get_db)):
    data = payload.model_dump(exclude_none=True, by_alias=True)
    if data.get("expiresAt"):
        data["expiresAt"] = data["expiresAt"].isoformat()
    return ok(conversation_service.update_memory(db, memory_id, data))


@router.delete("/{memory_id}")
def delete_memory(memory_id: str, db: Session = Depends(get_db)):
    conversation_service.delete_memory(db, memory_id)
    return ok({"deleted": memory_id})
