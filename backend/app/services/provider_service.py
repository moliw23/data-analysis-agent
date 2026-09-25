"""供应商管理：增删改查 + 连通性测试（同时探 chat 与 embeddings）。

密钥铁律：apiKey 只写不读。落库为 Fernet 密文（core/security.py），
对外只暴露掩码 hint；明文永不进响应、永不进日志（AC-06）。
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError, UpstreamError
from app.core.security import encrypt_key, mask_key
from app.models.base import new_uuid, utcnow
from app.repositories import llm_repo
from app.schemas.llm import ProviderCreate, ProviderUpdate
from app.services.llm_service import chat_completions_url

logger = logging.getLogger("app.provider")


def _view(row) -> dict[str, Any]:
    """对外视图：只含掩码，绝不含明文或密文。"""
    return {
        "id": row.id,
        "name": row.name,
        "baseUrl": row.base_url,
        "model": row.default_model,
        "apiKeyHint": row.api_key_hint,
        "isActive": row.is_active,
        "embeddingsSupported": row.embeddings_supported,
        "createdAt": row.created_at.isoformat() + "Z" if row.created_at else None,
    }


def list_providers(db: Session) -> list[dict[str, Any]]:
    return [_view(r) for r in llm_repo.list_providers(db)]


def get_provider_view(db: Session, provider_id: str) -> dict[str, Any]:
    row = llm_repo.get_provider(db, provider_id)
    if row is None:
        raise NotFoundError("供应商不存在")
    return _view(row)


def create_provider(db: Session, payload: ProviderCreate) -> dict[str, Any]:
    if llm_repo.get_provider_by_name(db, payload.name) is not None:
        raise ConflictError(f"供应商名称已存在：{payload.name}")
    row = llm_repo.create_provider(
        db,
        {
            "name": payload.name,
            "base_url": payload.base_url.rstrip("/"),
            "api_key_enc": encrypt_key(payload.api_key),
            "api_key_hint": mask_key(payload.api_key),
            "default_model": payload.model,
            "is_active": True,
        },
    )
    db.commit()
    logger.info("provider created: id=%s name=%s", row.id, row.name)
    return {"id": row.id, "apiKeyHint": row.api_key_hint}


def update_provider(
    db: Session, provider_id: str, payload: ProviderUpdate
) -> dict[str, Any]:
    row = llm_repo.get_provider(db, provider_id)
    if row is None:
        raise NotFoundError("供应商不存在")

    fields: dict[str, Any] = {}
    if payload.name is not None:
        fields["name"] = payload.name
    if payload.base_url is not None:
        fields["base_url"] = payload.base_url.rstrip("/")
    if payload.model is not None:
        fields["default_model"] = payload.model
    if payload.is_active is not None:
        fields["is_active"] = payload.is_active
    if payload.api_key is not None:  # 省略则不改
        fields["api_key_enc"] = encrypt_key(payload.api_key)
        fields["api_key_hint"] = mask_key(payload.api_key)

    if payload.name and payload.name != row.name:
        dup = llm_repo.get_provider_by_name(db, payload.name)
        if dup is not None and dup.id != row.id:
            raise ConflictError(f"供应商名称已存在：{payload.name}")

    llm_repo.update_provider(db, row, fields)
    db.commit()
    return {"id": row.id, "apiKeyHint": row.api_key_hint}


def delete_provider(db: Session, provider_id: str) -> dict[str, Any]:
    row = llm_repo.get_provider(db, provider_id)
    if row is None:
        raise NotFoundError("供应商不存在")
    llm_repo.detach_provider_from_routes(db, provider_id)
    llm_repo.soft_delete_provider(db, row)
    db.commit()
    logger.info("provider soft-deleted: id=%s", provider_id)
    return {"id": provider_id}


# ---------------------------- 连通性测试 ----------------------------
async def _probe_chat(row) -> dict[str, Any]:
    from app.core.security import KeyDecryptionError, decrypt_key

    settings = get_settings()
    started = time.perf_counter()
    try:
        api_key = decrypt_key(row.api_key_enc)
    except KeyDecryptionError as exc:
        return {"ok": False, "latencyMs": None, "error": str(exc)}
    body = {
        "model": row.default_model,
        "messages": [{"role": "user", "content": '请返回 {"ok":true}'}],
        "temperature": 0.0,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(
                chat_completions_url(row.base_url), headers=headers, json=body
            )
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "error": f"网络错误：{exc}",
        }
    latency = int((time.perf_counter() - started) * 1000)
    if resp.status_code >= 400:
        return {"ok": False, "latencyMs": latency, "error": f"HTTP {resp.status_code}"}
    return {"ok": True, "latencyMs": latency, "error": None}


async def _probe_embeddings(row) -> dict[str, Any]:
    from app.core.security import KeyDecryptionError, decrypt_key

    settings = get_settings()
    url = f"{row.base_url.rstrip('/')}/v1/embeddings"
    started = time.perf_counter()
    try:
        api_key = decrypt_key(row.api_key_enc)
    except KeyDecryptionError as exc:
        return {"ok": False, "latencyMs": None, "error": str(exc), "dim": None}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {"model": row.default_model, "input": ["ping"]}
    try:
        async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
            resp = await client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "error": f"网络错误：{exc}",
            "dim": None,
        }
    latency = int((time.perf_counter() - started) * 1000)
    if resp.status_code in (404, 405):
        return {
            "ok": False,
            "latencyMs": latency,
            "error": "该服务未实现 /v1/embeddings（将降级为关键词检索）",
            "dim": None,
        }
    if resp.status_code >= 400:
        return {"ok": False, "latencyMs": latency, "error": f"HTTP {resp.status_code}", "dim": None}
    dim: int | None = None
    try:
        data = resp.json().get("data") or []
        if data and isinstance(data[0].get("embedding"), list):
            dim = len(data[0]["embedding"])
    except (ValueError, AttributeError, IndexError):
        dim = None
    return {"ok": True, "latencyMs": latency, "error": None, "dim": dim}


async def test_provider(
    db: Session, provider_id: str, probes: list[str]
) -> dict[str, Any]:
    row = llm_repo.get_provider(db, provider_id)
    if row is None:
        raise NotFoundError("供应商不存在")
    if not probes:
        raise UpstreamError("probe 不能为空", data={"probe": []})

    result: dict[str, Any] = {}
    if "chat" in probes:
        result["chat"] = await _probe_chat(row)
    if "embeddings" in probes:
        emb = await _probe_embeddings(row)
        result["embeddings"] = emb
        _persist_probe(db, row, emb)
    return result


def _persist_probe(db: Session, row, emb: dict[str, Any]) -> None:
    from app.repositories import settings_repo

    if not settings_repo.table_exists(db, "embedding_probes"):
        return
    from app.models.settings import EmbeddingProbe

    db.add(
        EmbeddingProbe(
            id=new_uuid(),
            provider_id=row.id,
            model=row.default_model,
            dim=emb.get("dim"),
            ok=bool(emb.get("ok")),
            latency_ms=emb.get("latencyMs"),
            error=emb.get("error"),
            checked_at=utcnow(),
        )
    )
    row.embeddings_supported = bool(emb.get("ok"))
    db.commit()
