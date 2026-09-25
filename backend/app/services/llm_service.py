"""F1 LLM 网关：路由选择 + httpx 转发 + fallback 熔断 + 调用日志。

================================ 铁律 ================================
后端网关**只做转发与记账，不做计算**。
前端 engine/ 依旧是唯一计算引擎；narrate_insights 仍只让模型改写**已算好**的统计量。
禁止把"让模型算数"的能力加到后端。任何在此模块内出现的小计/聚合
（如 token 求和）都只属于"记账"，不得扩展为业务指标计算。
=====================================================================

本模块不含 fastapi.Request/Response，不抛 HTTPException（抛 core.errors 业务异常）。
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ProviderNotConfiguredError, UpstreamError
from app.core.logging import request_id_var
from app.core.security import KeyDecryptionError, decrypt_key
from app.models.base import utcnow
from app.repositories import llm_repo
from app.schemas.llm import LlmChatRequest

logger = logging.getLogger("app.llm")

# task_key -> 是否走默认 provider。默认路由在首次 GET /routes 时惰性落库。
DEFAULT_TASK_KEYS: tuple[str, ...] = (
    "plan_analysis",
    "narrate_insights",
    "parse_question",
    "text_to_sql",
    "memory_summarize",
)

_ERR_TIMEOUT = "upstream_timeout"
_ERR_HTTP = "upstream_http"
_ERR_NETWORK = "upstream_network"
_ERR_EMPTY = "upstream_empty"
_ERR_DECRYPT = "key_decrypt_failed"
_ERR_BREAKER = "breaker_open"


# ---------------------------- 熔断器 ----------------------------
@dataclass
class _BreakerState:
    failures: int = 0
    last_failure_ts: float = 0.0


_breakers: dict[str, _BreakerState] = {}


def _breaker_is_open(provider_id: str) -> bool:
    st = _breakers.get(provider_id)
    if st is None:
        return False
    s = get_settings()
    if st.failures < s.breaker_fail_threshold:
        return False
    return (time.monotonic() - st.last_failure_ts) < s.breaker_cooldown_seconds


def _breaker_record_failure(provider_id: str) -> None:
    st = _breakers.setdefault(provider_id, _BreakerState())
    st.failures += 1
    st.last_failure_ts = time.monotonic()


def _breaker_record_success(provider_id: str) -> None:
    _breakers.pop(provider_id, None)


def reset_breakers() -> None:
    """测试专用。"""
    _breakers.clear()


# ---------------------------- 路由选择 ----------------------------
@dataclass
class _ChainItem:
    provider_id: str
    provider_name: str
    base_url: str
    api_key_enc: str
    model: str


def _load_fallback(raw: str) -> list[dict[str, Any]]:
    try:
        items = json.loads(raw or "[]")
        return items if isinstance(items, list) else []
    except json.JSONDecodeError:
        return []


def ensure_default_routes(db: Session) -> None:
    """首次访问时把默认路由落库（primary 指向用户默认 provider）。"""
    providers = llm_repo.list_providers(db, include_inactive=False)
    primary = providers[0] if providers else None
    for task_key in DEFAULT_TASK_KEYS:
        if llm_repo.get_route(db, task_key) is None:
            llm_repo.upsert_route(
                db,
                task_key,
                primary.id if primary else None,
                primary.default_model if primary else None,
                [],
            )
    db.commit()


def _select_chain(db: Session, task_key: str) -> list[_ChainItem]:
    """按 task_key 取 primary + fallback；路由缺失/失效时回落默认 provider。"""
    route = llm_repo.get_route(db, task_key)

    candidates: list[tuple[str | None, str | None]] = []
    if route is not None:
        if route.primary_provider_id:
            candidates.append((route.primary_provider_id, route.primary_model))
        for fb in _load_fallback(route.fallback_json):
            candidates.append((fb.get("providerId"), fb.get("model")))
    if not candidates:
        # 路由未配置 / primary 已被解除，回落用户默认 provider（唯一活跃者）
        providers = llm_repo.list_providers(db, include_inactive=False)
        if providers:
            candidates.append((providers[0].id, providers[0].default_model))

    chain: list[_ChainItem] = []
    seen: set[str] = set()
    for pid, model in candidates:
        if not pid or pid in seen:
            continue
        provider = llm_repo.get_provider(db, pid)
        if provider is None or not provider.is_active:
            continue
        seen.add(pid)
        chain.append(
            _ChainItem(
                provider_id=provider.id,
                provider_name=provider.name,
                base_url=provider.base_url,
                api_key_enc=provider.api_key_enc,
                model=model or provider.default_model,
            )
        )
    if not chain:
        providers = llm_repo.list_providers(db, include_inactive=False)
        if providers:
            p = providers[0]
            chain.append(
                _ChainItem(
                    provider_id=p.id,
                    provider_name=p.name,
                    base_url=p.base_url,
                    api_key_enc=p.api_key_enc,
                    model=p.default_model,
                )
            )
    return chain


# ---------------------------- 上游转发 ----------------------------
def chat_completions_url(base_url: str) -> str:
    """OpenAI 兼容补全端点。前端 llmProvider.js 的请求形态必须逐字节兼容。"""
    return f"{base_url.rstrip('/')}/v1/chat/completions"


def _build_body(
    item: _ChainItem, request: LlmChatRequest
) -> dict[str, Any]:
    fmt = request.response_format
    return {
        "model": item.model,
        "messages": [m.model_dump() for m in request.messages],
        "temperature": request.temperature,
        "response_format": {"type": fmt.type if fmt else "json_object"},
    }


def _extract_content(payload: dict[str, Any]) -> str | None:
    choices = payload.get("choices") or []
    if not choices:
        return None
    message = choices[0].get("message") or {}
    content = message.get("content")
    return content if isinstance(content, str) and content else None


def _extract_usage(payload: dict[str, Any]) -> dict[str, int | None]:
    """上游未返回 usage 时三字段全部为 None（NULL=未知，0=确实为 0）。"""
    raw = payload.get("usage")
    if not isinstance(raw, dict):
        return {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None}
    prompt = raw.get("prompt_tokens")
    completion = raw.get("completion_tokens")
    total = raw.get("total_tokens")
    if total is None and isinstance(prompt, int) and isinstance(completion, int):
        total = prompt + completion  # 记账求和，非业务计算
    return {
        "prompt_tokens": prompt if isinstance(prompt, int) else None,
        "completion_tokens": completion if isinstance(completion, int) else None,
        "total_tokens": total if isinstance(total, int) else None,
    }


def _write_log(
    db: Session,
    *,
    request_id: str,
    item: _ChainItem | None,
    task_key: str,
    conversation_id: str | None,
    usage: dict[str, int | None] | None,
    latency_ms: int | None,
    status: str,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """每次尝试（含 fallback 的两次）都落一条日志并立即提交（AC-04/AC-05）。"""
    u = usage or {"prompt_tokens": None, "completion_tokens": None, "total_tokens": None}
    llm_repo.create_log(
        db,
        {
            "request_id": request_id,
            "provider_id": item.provider_id if item else None,
            "model": item.model if item else None,
            "task_key": task_key,
            "conversation_id": conversation_id,
            "prompt_tokens": u.get("prompt_tokens"),
            "completion_tokens": u.get("completion_tokens"),
            "total_tokens": u.get("total_tokens"),
            "latency_ms": latency_ms,
            "status": status,
            "error_code": error_code,
            "error_message": (error_message or "")[:500] or None,
        },
    )
    db.commit()


class _AttemptFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


async def _forward_once(
    item: _ChainItem, request: LlmChatRequest
) -> tuple[str, dict[str, int | None], int]:
    settings = get_settings()
    try:
        api_key = decrypt_key(item.api_key_enc)
    except KeyDecryptionError as exc:
        raise _AttemptFailure(_ERR_DECRYPT, str(exc)) from exc

    timeout = httpx.Timeout(
        request.timeout_ms / 1000.0, connect=min(5.0, settings.llm_timeout_seconds)
    )
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }
    started = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                chat_completions_url(item.base_url), headers=headers, json=_build_body(item, request)
            )
    except httpx.TimeoutException as exc:
        raise _AttemptFailure(_ERR_TIMEOUT, f"上游超时：{exc}") from exc
    except httpx.HTTPError as exc:
        raise _AttemptFailure(_ERR_NETWORK, f"上游网络错误：{exc}") from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    if resp.status_code >= 400:
        detail = (resp.text or "")[:200]
        raise _AttemptFailure(
            _ERR_HTTP, f"上游返回 HTTP {resp.status_code}：{detail}"
        )
    try:
        payload = resp.json()
    except ValueError as exc:
        raise _AttemptFailure(_ERR_EMPTY, "上游返回非 JSON") from exc

    content = _extract_content(payload)
    usage = _extract_usage(payload)
    if content is None:
        # usage 可能仍有值，作为错误尝试一并记账
        raise _AttemptFailure(_ERR_EMPTY, "上游未返回内容")
    return content, usage, latency_ms


# ---------------------------- 主入口 ----------------------------
async def chat(db: Session, request: LlmChatRequest) -> dict[str, Any]:
    """网关主入口。主 provider 失败即在 3s 内尝试 fallback，两次都落日志。"""
    request_id = request_id_var.get() or ""
    task_key = request.task_key.value if hasattr(request.task_key, "value") else str(request.task_key)
    chain = _select_chain(db, task_key)
    if not chain:
        _write_log(
            db,
            request_id=request_id,
            item=None,
            task_key=task_key,
            conversation_id=request.conversation_id,
            usage=None,
            latency_ms=None,
            status="error",
            error_code="not_configured",
            error_message="未配置任何可用 provider",
        )
        raise ProviderNotConfiguredError()

    settings = get_settings()
    max_attempts = max(1, min(settings.llm_max_attempts, len(chain)))
    last_failure: _AttemptFailure | None = None

    for index, item in enumerate(chain):
        if index >= max_attempts:
            break
        if _breaker_is_open(item.provider_id):
            _write_log(
                db,
                request_id=request_id,
                item=item,
                task_key=task_key,
                conversation_id=request.conversation_id,
                usage=None,
                latency_ms=None,
                status="error",
                error_code=_ERR_BREAKER,
                error_message="熔断窗口内跳过该 provider",
            )
            last_failure = _AttemptFailure(_ERR_BREAKER, "熔断窗口内跳过")
            continue
        try:
            content, usage, latency_ms = await _forward_once(item, request)
        except _AttemptFailure as failure:
            _breaker_record_failure(item.provider_id)
            last_failure = failure
            _write_log(
                db,
                request_id=request_id,
                item=item,
                task_key=task_key,
                conversation_id=request.conversation_id,
                usage=None,
                latency_ms=None,
                status="error",
                error_code=failure.code,
                error_message=failure.message,
            )
            continue

        _breaker_record_success(item.provider_id)
        _write_log(
            db,
            request_id=request_id,
            item=item,
            task_key=task_key,
            conversation_id=request.conversation_id,
            usage=usage,
            latency_ms=latency_ms,
            status="ok",
        )
        return {
            "content": content,
            "mode": "llm",
            "providerId": item.provider_id,
            "model": item.model,
            "usage": {
                "promptTokens": usage["prompt_tokens"],
                "completionTokens": usage["completion_tokens"],
                "totalTokens": usage["total_tokens"],
            },
            "latencyMs": latency_ms,
            "attempts": index + 1,
        }

    message = last_failure.message if last_failure else "全部 provider 均失败"
    raise UpstreamError(message, data={"attempts": min(len(chain), max_attempts)})


# ---------------------------- 查询类 ----------------------------
def get_routes(db: Session) -> list[dict[str, Any]]:
    ensure_default_routes(db)
    out = []
    for row in llm_repo.list_routes(db):
        out.append(
            {
                "taskKey": row.task_key,
                "primaryProviderId": row.primary_provider_id,
                "primaryModel": row.primary_model,
                "fallback": _load_fallback(row.fallback_json),
            }
        )
    return out


def put_routes(db: Session, items: list[Any]) -> int:
    for item in items:
        task_key = getattr(item, "task_key", None)
        key = task_key.value if hasattr(task_key, "value") else str(task_key)
        llm_repo.upsert_route(
            db,
            key,
            item.primary_provider_id,
            item.primary_model,
            item.fallback,
        )
    db.commit()
    return len(items)


def list_logs(
    db: Session,
    *,
    page: int,
    limit: int,
    status: str | None,
    task_key: str | None,
    provider_id: str | None,
) -> tuple[list[dict[str, Any]], int]:
    rows, total = llm_repo.list_logs(
        db,
        page=page,
        limit=limit,
        status=status,
        task_key=task_key,
        provider_id=provider_id,
    )
    return [_log_view(r) for r in rows], total


def _iso(value) -> str | None:
    return value.isoformat() + "Z" if value else None


def _log_view(row) -> dict[str, Any]:
    return {
        "id": row.id,
        "requestId": row.request_id,
        "taskKey": row.task_key,
        "providerId": row.provider_id,
        "model": row.model,
        "status": row.status,
        "promptTokens": row.prompt_tokens,
        "completionTokens": row.completion_tokens,
        "totalTokens": row.total_tokens,
        "latencyMs": row.latency_ms,
        "errorCode": row.error_code,
        "errorMessage": row.error_message,
        "createdAt": _iso(row.created_at),
    }


def stats(
    db: Session, *, group_by: str, date_from=None, date_to=None
) -> dict[str, Any]:
    items = llm_repo.aggregate_usage(
        db, group_by=group_by, date_from=date_from, date_to=date_to
    )
    total = {
        "key": "total",
        "promptTokens": _sum(items, "promptTokens"),
        "completionTokens": _sum(items, "completionTokens"),
        "totalTokens": _sum(items, "totalTokens"),
        "calls": sum(i["calls"] for i in items),
    }
    return {"items": items, "total": total}


def _sum(items: list[dict[str, Any]], key: str) -> int | None:
    """全为 NULL 时返回 None（未知），否则返回求和（0 表示确实为 0）。"""
    values = [i[key] for i in items if i.get(key) is not None]
    return int(sum(values)) if values else None


def utcnow_for_log() -> Any:  # pragma: no cover - 便于测试替换
    return utcnow()
