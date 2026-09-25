"""RAG 知识库相关表：knowledge_bases / kb_documents / kb_chunks / kb_queries
+ kb_chunk_fts（FTS5 trigram 虚拟表，Spec §6 表 7-11）。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, SoftDeleteMixin, TimestampMixin, UuidPkMixin


class KnowledgeBase(Base, UuidPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "knowledge_bases"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_provider_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    embedding_dim: Mapped[int | None] = mapped_column(Integer, nullable=True)
    collection_name: Mapped[str | None] = mapped_column(String(80), nullable=True, unique=True)
    doc_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 缓存列，口径以 COUNT(kb_chunks) 为准
    index_status: Mapped[str] = mapped_column(String(16), nullable=False, default="empty")  # empty/building/ready/failed
    needs_reindex: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class KbDocument(Base, UuidPkMixin, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "kb_documents"

    kb_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # AC-28 出本机凭据：以"入库档位"为准，而非当前档位
    ingested_mode: Mapped[str | None] = mapped_column(String(16), nullable=True)
    ingested_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("kb_id", "sha256", name="uq_kbdoc_kb_sha"),
        Index("ix_kbdoc_kb_status", "kb_id", "status"),
        Index("ix_kbdoc_ingested_mode", "ingested_mode"),
    )


class KbChunk(Base, UuidPkMixin, TimestampMixin):
    __tablename__ = "kb_chunks"

    doc_id: Mapped[str] = mapped_column(String(36), nullable=False)
    kb_id: Mapped[str] = mapped_column(String(36), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    char_len: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    token_est: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding_id: Mapped[str | None] = mapped_column(String(80), nullable=True)

    __table_args__ = (
        Index("ix_kbchunk_doc_seq", "doc_id", "seq"),
        Index("ix_kbchunk_kb_seq", "kb_id", "seq"),
    )


class KbQuery(Base, UuidPkMixin, TimestampMixin):
    __tablename__ = "kb_queries"

    kb_id: Mapped[str] = mapped_column(String(36), nullable=False)
    query_text: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False)  # vector/keyword/hybrid/hybrid_degraded
    top_k: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    hit_chunk_ids_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    feedback: Mapped[float | None] = mapped_column(Float, nullable=True)  # +1 有用 / -1 无用

    __table_args__ = (Index("ix_kbquery_kb_created", "kb_id", "created_at"),)


# FTS5 虚拟表不走 ORM：init_db 时用原生 DDL 幂等创建（IF NOT EXISTS）
FTS_DDL = (
    "CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunk_fts USING fts5("
    "chunk_id UNINDEXED, content, tokenize='trigram')"
)
