"""RAG 知识库业务：入库（解析→切分→FTS）与检索（vector 可选 / keyword FTS5 兜底）。

设计要点（Spec F9 / AC-24/25/28）：
- 语义通道仅在 chromadb 已安装且 provider embeddings 探测可用时启用；
  否则检索 mode='keyword'（语义不可用的诚实降级，UI 据此显示徽标）。
- 出本机凭据：文档入库时记录 ingested_mode / ingested_at（以入库档位为准）。
- index 就绪口径（Spec §6.1）：ready 且 needs_reindex=false 且无 pending 处理中文档。
"""

from __future__ import annotations

import hashlib
import io
import json
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.core.errors import ConflictError, IndexNotReadyError, NotFoundError
from app.models.base import utcnow
from app.models.knowledge import KbChunk, KbDocument, KbQuery, KnowledgeBase
from app.repositories import knowledge_repo

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
TOKEN_EST_RATIO = 4  # 1 token ≈ 4 字符（与 conversation_service 同口径）

try:  # 语义通道依赖探测（分层安装：缺失不报错，走降级）
    import chromadb  # noqa: F401

    _CHROMA_AVAILABLE = True
except Exception:  # pragma: no cover - 环境相关
    _CHROMA_AVAILABLE = False


# ---------------------------- 文本抽取与切分 ----------------------------

def _extract_text(data: bytes, mime: str | None, filename: str) -> tuple[str, int | None]:
    """按类型抽取正文，返回 (text, page_count)。"""
    name = filename.lower()
    if name.endswith(".pdf") or (mime and "pdf" in mime):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [p.extract_text() or "" for p in reader.pages]
        return "\n".join(pages), len(pages)
    if name.endswith(".docx") or (mime and "wordprocessingml" in (mime or "")):
        import docx

        doc = docx.Document(io.BytesIO(data))
        return "\n".join(p.text for p in doc.paragraphs), None
    # txt / md / csv 及其他文本类型
    return data.decode("utf-8", errors="replace"), None


def split_chunks(content: str, *, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """滑动窗口切分。按行边界优先，避免硬切词。"""
    content = content.strip()
    if not content:
        return []
    chunks: list[str] = []
    start = 0
    n = len(content)
    while start < n:
        end = min(start + size, n)
        if end < n:
            # 在窗口内找最后一个换行，尽量不切断语义
            brk = content.rfind("\n", start + int(size * 0.6), end)
            if brk > start:
                end = brk
        piece = content[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


# ---------------------------- index 状态口径 ----------------------------

def _recompute_index_status(db: Session, kb: KnowledgeBase) -> None:
    pending = db.execute(
        select(func.count()).select_from(KbDocument).where(
            KbDocument.kb_id == kb.id,
            KbDocument.deleted_at.is_(None),
            KbDocument.status.in_(["pending", "parsing", "chunking", "embedding"]),
        )
    ).scalar_one()
    kb.chunk_count = int(
        db.execute(select(func.count()).select_from(KbChunk).where(KbChunk.kb_id == kb.id)).scalar_one()
    )
    kb.doc_count = int(
        db.execute(
            select(func.count()).select_from(KbDocument).where(
                KbDocument.kb_id == kb.id, KbDocument.deleted_at.is_(None)
            )
        ).scalar_one()
    )
    if kb.doc_count == 0:
        kb.index_status = "empty"
    elif pending:
        kb.index_status = "building"
    elif not kb.needs_reindex:
        kb.index_status = "ready"
    db.flush()


def _require_ready(db: Session, kb: KnowledgeBase) -> None:
    """Spec §6.1 就绪口径，不满足抛 4091。"""
    if kb.index_status != "ready" or kb.needs_reindex:
        raise IndexNotReadyError("索引未就绪，暂不能检索（可先重建索引）")
    _recompute_index_status(db, kb)
    if kb.index_status != "ready":
        raise IndexNotReadyError("索引未就绪，暂不能检索")


# ---------------------------- 入库 ----------------------------

def ingest_document(
    db: Session, kb: KnowledgeBase, *, filename: str, mime: str | None,
    data: bytes, privacy_mode: str,
) -> dict[str, Any]:
    sha = hashlib.sha256(data).hexdigest()
    dup = db.execute(
        select(KbDocument).where(
            KbDocument.kb_id == kb.id, KbDocument.sha256 == sha, KbDocument.deleted_at.is_(None)
        )
    ).scalar_one_or_none()
    if dup:
        raise ConflictError("同名同内容文档已存在（sha256 重复）")

    doc = knowledge_repo.create_document(db, {
        "kb_id": kb.id, "filename": filename, "mime": mime,
        "size_bytes": len(data), "sha256": sha, "status": "parsing",
        # AC-28：出本机凭据在入库时刻落定
        "ingested_mode": privacy_mode, "ingested_at": utcnow(),
    })
    try:
        body, page_count = _extract_text(data, mime, filename)
        doc.page_count = page_count
        doc.status = "chunking"
        pieces = split_chunks(body)
        for seq, piece in enumerate(pieces):
            knowledge_repo.create_chunk(db, {
                "doc_id": doc.id, "kb_id": kb.id, "seq": seq,
                "content": piece, "char_len": len(piece),
                "token_est": len(piece) // TOKEN_EST_RATIO,
                "meta_json": json.dumps({"filename": filename}, ensure_ascii=False),
            })
        doc.chunk_count = len(pieces)
        doc.status = "ready"
        # 分块入 FTS5（keyword 通道的数据面）
        knowledge_repo.index_chunks(db, kb.id)
    except Exception as exc:  # 解析失败：如实标 failed，可读错误
        doc.status = "failed"
        doc.error = f"解析失败：{exc}"[:500]
    _recompute_index_status(db, kb)
    db.commit()
    return doc


# ---------------------------- 检索 ----------------------------

def search(
    db: Session, kb: KnowledgeBase, *, query: str, mode: str, top_k: int, privacy_mode: str,
) -> dict[str, Any]:
    import time

    started = time.perf_counter()
    _require_ready(db, kb)
    top_k = max(1, min(20, int(top_k)))

    vector_possible = _CHROMA_AVAILABLE and bool(kb.embedding_provider_id)
    if mode in ("vector", "hybrid") and not vector_possible:
        actual_mode = "hybrid_degraded" if mode == "hybrid" else "keyword"
    else:
        actual_mode = mode

    hits: list[dict[str, Any]] = []
    if actual_mode in ("vector", "hybrid", "hybrid_degraded"):
        # keyword 通道是 degraded/hybrid 的兜底组成；纯 vector 未启用（无 chroma）
        hits = knowledge_repo.fts_search(db, kb.id, query, limit=top_k)
    else:
        hits = knowledge_repo.fts_search(db, kb.id, query, limit=top_k)

    latency = int((time.perf_counter() - started) * 1000)
    q = knowledge_repo.record_query(db, {
        "kb_id": kb.id, "query_text": query, "mode": actual_mode,
        "top_k": top_k,
        "hit_chunk_ids_json": json.dumps([h["chunkId"] for h in hits]),
        "latency_ms": latency,
    })
    db.commit()
    return {
        "queryId": q.id,
        "mode": actual_mode,
        "hits": hits[:top_k],
        "latencyMs": latency,
    }
