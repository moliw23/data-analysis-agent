"""知识库数据访问（只存取；编排与口径在 services/knowledge_service）。"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.base import utcnow
from app.models.knowledge import KbChunk, KbDocument, KbQuery, KnowledgeBase


# ---------------------------- knowledge bases ----------------------------

def get_kb(db: Session, kb_id: str) -> KnowledgeBase | None:
    row = db.get(KnowledgeBase, kb_id)
    if row is None or row.deleted_at is not None:
        return None
    return row


def get_kb_by_name(db: Session, name: str) -> KnowledgeBase | None:
    stmt = select(KnowledgeBase).where(
        KnowledgeBase.name == name, KnowledgeBase.deleted_at.is_(None)
    )
    return db.execute(stmt).scalar_one_or_none()


def list_kbs(db: Session, *, page: int = 1, limit: int = 20) -> tuple[list[KnowledgeBase], int]:
    conds = [KnowledgeBase.deleted_at.is_(None)]
    total = db.execute(select(func.count()).select_from(KnowledgeBase).where(*conds)).scalar_one()
    stmt = (
        select(KnowledgeBase).where(*conds)
        .order_by(KnowledgeBase.updated_at.desc())
        .offset((page - 1) * limit).limit(limit)
    )
    return list(db.execute(stmt).scalars().all()), int(total)


def create_kb(db: Session, fields: dict[str, Any]) -> KnowledgeBase:
    row = KnowledgeBase(**fields)
    db.add(row)
    db.flush()
    return row


def update_kb(db: Session, row: KnowledgeBase, fields: dict[str, Any]) -> KnowledgeBase:
    for key, value in fields.items():
        setattr(row, key, value)
    db.flush()
    return row


def soft_delete_kb(db: Session, row: KnowledgeBase) -> None:
    """软删知识库；对应 Chroma collection 仅逻辑作废（纯 API 调用，不删目录）。"""
    row.deleted_at = utcnow()
    db.flush()


# ---------------------------- documents ----------------------------

def create_document(db: Session, fields: dict[str, Any]) -> KbDocument:
    row = KbDocument(**fields)
    db.add(row)
    db.flush()
    return row


def get_document(db: Session, kb_id: str, doc_id: str) -> KbDocument | None:
    row = db.get(KbDocument, doc_id)
    if row is None or row.deleted_at is not None or row.kb_id != kb_id:
        return None
    return row


def list_documents(
    db: Session, kb_id: str, *, page: int = 1, limit: int = 50, status: str | None = None
) -> tuple[list[KbDocument], int]:
    conds = [KbDocument.kb_id == kb_id, KbDocument.deleted_at.is_(None)]
    if status:
        conds.append(KbDocument.status == status)
    total = db.execute(select(func.count()).select_from(KbDocument).where(*conds)).scalar_one()
    stmt = (
        select(KbDocument).where(*conds)
        .order_by(KbDocument.created_at.desc())
        .offset((page - 1) * limit).limit(limit)
    )
    return list(db.execute(stmt).scalars().all()), int(total)


def soft_delete_document(db: Session, row: KbDocument) -> None:
    row.deleted_at = utcnow()
    db.flush()


# ---------------------------- chunks ----------------------------

def create_chunk(db: Session, fields: dict[str, Any]) -> KbChunk:
    row = KbChunk(**fields)
    db.add(row)
    db.flush()
    return row


def list_chunks(db: Session, kb_id: str, doc_id: str, *, page: int = 1, limit: int = 20):
    conds = [KbChunk.kb_id == kb_id, KbChunk.doc_id == doc_id]
    total = db.execute(select(func.count()).select_from(KbChunk).where(*conds)).scalar_one()
    stmt = (
        select(KbChunk).where(*conds).order_by(KbChunk.seq.asc())
        .offset((page - 1) * limit).limit(limit)
    )
    return list(db.execute(stmt).scalars().all()), int(total)


def delete_chunks_by_doc(db: Session, kb_id: str, doc_id: str) -> int:
    """物理删除分块（分块是派生数据，重建即可；非用户数据，不适用软删）。"""
    rows = list(db.execute(
        select(KbChunk).where(KbChunk.kb_id == kb_id, KbChunk.doc_id == doc_id)
    ).scalars())
    for r in rows:
        # 同步清 FTS 行（外部内容表模式：fts 与主表独立维护）
        db.execute(
            text("DELETE FROM kb_chunk_fts WHERE chunk_id = :cid"), {"cid": r.id}
        )
        db.delete(r)
    db.flush()
    return len(rows)


# ---------------------------- FTS 检索 ----------------------------

def fts_search(db: Session, kb_id: str, query: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """FTS5 trigram 关键词检索，JOIN 出文档名与片段上下文。

    trigram 无需 jieba，中文子串可直接命中（Spec §6 表 10）。
    FTS5 MATCH 的查询词做引号包裹，避免把用户输入当 FTS5 语法解析。
    """
    safe_query = '"' + query.replace('"', '""') + '"'
    stmt = text(
        """
        SELECT f.chunk_id, c.content, c.seq, d.filename,
               bm25(kb_chunk_fts) AS score
        FROM kb_chunk_fts f
        JOIN kb_chunks c ON c.id = f.chunk_id
        JOIN kb_documents d ON d.id = c.doc_id AND d.deleted_at IS NULL
        WHERE kb_chunk_fts MATCH :q AND c.kb_id = :kb
        ORDER BY score
        LIMIT :lim
        """
    )
    rows = db.execute(stmt, {"q": safe_query, "kb": kb_id, "lim": limit}).mappings().all()
    return [
        {
            "chunkId": r["chunk_id"],
            "content": r["content"],
            "seq": int(r["seq"]),
            "filename": r["filename"],
            "score": max(0.0, 1.0 / (1.0 + abs(float(r["score"] or 0)))),
        }
        for r in rows
    ]


def index_chunks(db: Session, kb_id: str) -> int:
    """把某库当前未入 FTS 的分块补入（幂等：已存在的跳过）。"""
    existing = set(db.execute(text("SELECT chunk_id FROM kb_chunk_fts")).scalars())
    chunks = list(db.execute(
        select(KbChunk).where(KbChunk.kb_id == kb_id).order_by(KbChunk.seq.asc())
    ).scalars())
    added = 0
    for c in chunks:
        if c.id in existing:
            continue
        db.execute(
            text("INSERT INTO kb_chunk_fts(chunk_id, content) VALUES (:cid, :txt)"),
            {"cid": c.id, "txt": c.content},
        )
        added += 1
    db.flush()
    return added


# ---------------------------- queries ----------------------------

def record_query(db: Session, fields: dict[str, Any]) -> KbQuery:
    row = KbQuery(**fields)
    db.add(row)
    db.flush()
    return row


def set_feedback(db: Session, kb_id: str, query_id: str, feedback: float) -> KbQuery | None:
    row = db.get(KbQuery, query_id)
    if row is None or row.kb_id != kb_id:
        return None
    row.feedback = feedback
    db.flush()
    return row
