"""会话端点：列表/新建/详情/改名归档/删除(归档)/消息/上下文/摘要（P2-4，openapi 446-684 行）。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.common import ok
from app.services import conversation_service

router = APIRouter(prefix="/api/v1/conversations", tags=["conversations"])


@router.get("")
def list_conversations(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    archived: bool = Query(False),
    db: Session = Depends(get_db),
):
    return ok(conversation_service.list_conversations(db, page=page, limit=limit, archived=archived))


@router.post("", status_code=201)
def create_conversation(payload: dict, db: Session = Depends(get_db)):
    return ok(conversation_service.create_conversation(db, payload), )


@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, db: Session = Depends(get_db)):
    return ok(conversation_service.get_conversation(db, conversation_id))


@router.patch("/{conversation_id}")
def update_conversation(conversation_id: str, payload: dict, db: Session = Depends(get_db)):
    return ok(conversation_service.update_conversation(db, conversation_id, payload))


@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: str, db: Session = Depends(get_db)):
    conversation_service.delete_conversation(db, conversation_id)
    return ok({"archived": True})


@router.get("/{conversation_id}/messages")
def list_messages(
    conversation_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    return ok(conversation_service.list_messages(db, conversation_id, page=page, limit=limit))


@router.post("/{conversation_id}/messages", status_code=201)
async def append_message(conversation_id: str, payload: dict, db: Session = Depends(get_db)):
    return ok(await conversation_service.append_message(db, conversation_id, payload))


@router.delete("/{conversation_id}/messages/{message_id}")
def delete_message(conversation_id: str, message_id: str, db: Session = Depends(get_db)):
    conversation_service.delete_message(db, conversation_id, message_id)
    return ok({"deleted": message_id})


@router.get("/{conversation_id}/context")
def get_context(
    conversation_id: str,
    budgetTokens: int = Query(4000, alias="budgetTokens", ge=500, le=32000),
    db: Session = Depends(get_db),
):
    return ok(conversation_service.build_context(db, conversation_id, budget_tokens=budgetTokens))


@router.post("/{conversation_id}/summarize")
async def summarize(conversation_id: str, payload: dict | None = None, db: Session = Depends(get_db)):
    keep_recent = (payload or {}).get("keepRecent", 10)
    return ok(await conversation_service.summarize(db, conversation_id, keep_recent=keep_recent))
