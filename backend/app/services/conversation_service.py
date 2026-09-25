"""会话编排：消息追加 / autoRespond 网关调用 / 上下文组装 / 滚动摘要。

铁律（Spec §4.3）：本服务只做编排与裁剪，不做数据计算；
token 预算是"字符估算"（1 token ≈ 4 字符的保守近似），用于裁剪而非计费。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import ConflictError, NotFoundError
from app.models.conversation import Memory, Message
from app.repositories import conversation_repo, memory_repo
from app.models.base import utcnow

# 记忆开关键（AC-21：关闭后 context 不再注入任何记忆）
CHARS_PER_TOKEN = 4
DEFAULT_BUDGET_TOKENS = 4000


def _message_view(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "conversationId": row.conversation_id,
        "role": row.role,
        "content": row.content,
        "toolName": row.tool_name,
        "toolPayload": row.tool_payload_json,
        "tokens": row.tokens,
        "createdAt": row.created_at.isoformat() + "Z" if row.created_at else None,
    }


def _conversation_view(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "title": row.title,
        "datasetId": row.dataset_id,
        "knowledgeBaseId": row.knowledge_base_id,
        "summary": row.summary,
        "summarizedCount": row.summarized_count,
        "messageCount": row.message_count,
        "archivedAt": row.archived_at.isoformat() + "Z" if row.archived_at else None,
        "createdAt": row.created_at.isoformat() + "Z" if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() + "Z" if row.updated_at else None,
    }


def _memory_view(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "scope": row.scope,
        "conversationId": row.conversation_id,
        "datasetId": row.dataset_id,
        "kind": row.kind,
        "content": row.content,
        "weight": row.weight,
        "sourceMessageId": row.source_message_id,
        "expiresAt": row.expires_at.isoformat() + "Z" if row.expires_at else None,
        "createdAt": row.created_at.isoformat() + "Z" if row.created_at else None,
        "updatedAt": row.updated_at.isoformat() + "Z" if row.updated_at else None,
    }


# ---------------------------- conversations ----------------------------

def list_conversations(db: Session, *, page: int, limit: int, archived: bool) -> dict[str, Any]:
    rows, total = conversation_repo.list_conversations(db, page=page, limit=limit, archived=archived)
    return {
        "items": [_conversation_view(r) for r in rows],
        "total": total, "page": page, "limit": limit,
        "hasMore": page * limit < total,
    }


def create_conversation(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    row = conversation_repo.create_conversation(db, {
        "title": (payload.get("title") or "新会话")[:200],
        "dataset_id": payload.get("datasetId"),
        "knowledge_base_id": payload.get("knowledgeBaseId"),
    })
    db.commit()
    return _conversation_view(row)


def _require(db: Session, conversation_id: str):
    row = conversation_repo.get_conversation(db, conversation_id)
    if row is None:
        raise NotFoundError("会话不存在")
    return row


def get_conversation(db: Session, conversation_id: str) -> dict[str, Any]:
    return _conversation_view(_require(db, conversation_id))


def update_conversation(db: Session, conversation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    row = _require(db, conversation_id)
    fields: dict[str, Any] = {}
    if "title" in payload and payload["title"] is not None:
        fields["title"] = str(payload["title"])[:200]
    if "archived" in payload and payload["archived"] is not None:
        fields["archived_at"] = utcnow() if payload["archived"] else None
    conversation_repo.update_conversation(db, row, fields)
    db.commit()
    return _conversation_view(row)


def delete_conversation(db: Session, conversation_id: str) -> None:
    conversation_repo.archive_conversation(db, _require(db, conversation_id))
    db.commit()


# ---------------------------- messages ----------------------------

def list_messages(db: Session, conversation_id: str, *, page: int, limit: int) -> dict[str, Any]:
    _require(db, conversation_id)
    rows, total = conversation_repo.list_messages(db, conversation_id, page=page, limit=limit)
    return {
        "items": [_message_view(r) for r in rows],
        "total": total, "page": page, "limit": limit,
        "hasMore": page * limit < total,
    }


async def append_message(db: Session, conversation_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    """追加消息。autoRespond=true 时调用 LLM 网关编排一次应答（AC-04 日志语义由网关保证）。"""
    conv = _require(db, conversation_id)
    role = payload.get("role") or "user"
    content = payload.get("content")
    if not content or not str(content).strip():
        raise ConflictError("消息内容不能为空")

    user_row = conversation_repo.create_message(db, {
        "conversation_id": conversation_id,
        "role": role,
        "content": str(content),
        "tool_name": payload.get("toolName"),
        "tool_payload_json": payload.get("toolPayload"),
    })
    conversation_repo.bump_message_count(db, conversation_id, 1)

    assistant_view = None
    usage = None
    if payload.get("autoRespond"):
        # 延迟导入避免 services ↔ services 循环依赖（llm_service 不依赖本模块）
        from app.services import llm_service
        from app.schemas.llm import LlmChatRequest

        context = build_context(db, conversation_id, budget_tokens=DEFAULT_BUDGET_TOKENS)
        req = LlmChatRequest(
            task_key="chat_reply",
            messages=context["messages"],
            conversation_id=conversation_id,
        )
        result = await llm_service.chat(db, req)
        usage = result.get("usage") or {}
        assistant_row = conversation_repo.create_message(db, {
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": result.get("content", ""),
            "tokens": usage.get("totalTokens"),
        })
        conversation_repo.bump_message_count(db, conversation_id, 1)
        assistant_view = _message_view(assistant_row)
        conv = conversation_repo.get_conversation(db, conversation_id)

    db.commit()
    return {
        "userMessage": _message_view(user_row),
        "assistantMessage": assistant_view,
        "usage": usage,
    }


def delete_message(db: Session, conversation_id: str, message_id: str) -> None:
    _require(db, conversation_id)
    row = db.get(Message, message_id)
    if row is None or row.conversation_id != conversation_id:
        raise NotFoundError("消息不存在")
    conversation_repo.delete_message(db, row)
    conversation_repo.bump_message_count(db, conversation_id, -1)
    db.commit()


# ---------------------------- context 组装 ----------------------------

def _est_tokens(text: str) -> int:
    return max(1, len(text) // CHARS_PER_TOKEN)


def build_context(db: Session, conversation_id: str, *, budget_tokens: int = DEFAULT_BUDGET_TOKENS) -> dict[str, Any]:
    """记忆注入 + 摘要压缩 + 预算裁剪（openapi GET /conversations/{id}/context）。

    组装顺序：[system(摘要+记忆)] + 未被摘要覆盖的尾部消息（预算内从新到旧保留）。
    """
    conv = _require(db, conversation_id)
    budget = max(500, min(32000, int(budget_tokens)))

    injected: list[dict[str, Any]] = []
    memory_block = ""
    if memory_repo.is_memory_enabled(db):  # AC-21：开关关闭则零注入
        mems = memory_repo.memories_for_injection(db, conversation_id=conversation_id)
        injected = [_memory_view(m) for m in mems]
        if injected:
            lines = [f"- ({m['kind']}) {m['content']}" for m in injected]
            memory_block = "以下是需长期遵守的既知信息：\n" + "\n".join(lines)

    tail = conversation_repo.list_messages_asc(db, conversation_id)[conv.summarized_count:]
    # 预算从最新往回收
    kept: list = []
    used = _est_tokens(memory_block) + (len(conv.summary) // CHARS_PER_TOKEN if conv.summary else 0)
    for msg in reversed(tail):
        cost = _est_tokens(msg.content)
        if used + cost > budget and kept:
            break
        if used + cost > budget:
            break
        kept.append(msg)
        used += cost
    kept.reverse()

    messages: list[dict[str, Any]] = []
    sys_parts = []
    if conv.summary:
        sys_parts.append(f"此前对话摘要：{conv.summary}")
    if memory_block:
        sys_parts.append(memory_block)
    if sys_parts:
        messages.append({"role": "system", "content": "\n\n".join(sys_parts)})
    for msg in kept:
        messages.append({"role": msg.role, "content": msg.content})

    estimated = sum(_est_tokens(m["content"]) for m in messages)
    return {
        "messages": messages,
        "summary": conv.summary,
        "injectedMemories": injected,
        "estimatedTokens": estimated,
        "truncated": len(kept) < len(tail),
    }


# ---------------------------- 滚动摘要 ----------------------------

async def summarize(db: Session, conversation_id: str, *, keep_recent: int = 10) -> dict[str, Any]:
    """手动触发滚动摘要。无可用 provider 时如实抛 4010（不伪造摘要）。"""
    conv = _require(db, conversation_id)
    keep_recent = max(0, min(100, int(keep_recent)))
    all_msgs = conversation_repo.list_messages_asc(db, conversation_id)
    target = all_msgs[: max(0, len(all_msgs) - keep_recent)]
    if len(target) <= conv.summarized_count:
        raise ConflictError("没有可摘要的新消息")

    from app.services import llm_service
    from app.schemas.llm import LlmChatRequest

    transcript = "\n".join(f"{m.role}: {m.content[:500]}" for m in target[conv.summarized_count:])
    req = LlmChatRequest(
        task_key="memory_summarize",
        messages=[
            {"role": "system", "content": "把对话压缩为 200 字以内的中文摘要，保留实体、指标口径与结论。只输出摘要正文。"},
            {"role": "user", "content": transcript or "(空)"},
        ],
        conversation_id=conversation_id,
    )
    result = await llm_service.chat(db, req)
    new_count = len(target)
    prev = conv.summary
    summary = result.get("content", "").strip()
    if prev:
        summary = f"{prev}\n{summary}"
    conversation_repo.set_summary(db, conversation_id, summary, new_count)
    db.commit()
    return {
        "summary": summary,
        "summarizedMessages": new_count - conv.summarized_count,
        "usage": result.get("usage"),
    }


# ---------------------------- memories ----------------------------

def list_memories(db: Session, *, page: int, limit: int, scope: str | None,
                  conversation_id: str | None, kind: str | None) -> dict[str, Any]:
    rows, total = memory_repo.list_memories(
        db, page=page, limit=limit, scope=scope, conversation_id=conversation_id, kind=kind
    )
    return {
        "items": [_memory_view(r) for r in rows],
        "total": total, "page": page, "limit": limit,
        "hasMore": page * limit < total,
    }


def create_memory(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    row = memory_repo.create_memory(db, {
        "scope": payload["scope"],
        "conversation_id": payload.get("conversationId"),
        "dataset_id": payload.get("datasetId"),
        "kind": payload["kind"],
        "content": payload["content"],
        "weight": payload.get("weight", 1.0),
    })
    db.commit()
    return _memory_view(row)


def update_memory(db: Session, memory_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    row = db.get(Memory, memory_id)
    if row is None or row.deleted_at is not None:
        raise NotFoundError("记忆不存在")
    fields = {}
    if payload.get("content") is not None:
        fields["content"] = payload["content"]
    if payload.get("weight") is not None:
        fields["weight"] = payload["weight"]
    if "expiresAt" in payload:
        fields["expires_at"] = payload["expiresAt"]
    memory_repo.update_memory(db, row, fields)
    db.commit()
    return _memory_view(row)


def delete_memory(db: Session, memory_id: str) -> None:
    row = db.get(Memory, memory_id)
    if row is None or row.deleted_at is not None:
        raise NotFoundError("记忆不存在")
    memory_repo.delete_memory(db, row)
    db.commit()
