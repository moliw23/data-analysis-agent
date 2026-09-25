"""RAG 知识库端点（P2-5 全量实现；F0 闸门与能力同生，strict 档 4030 语义不变）。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_privacy
from app.core.errors import ConflictError, NotFoundError
from app.repositories import knowledge_repo
from app.schemas.common import ok
from app.services import knowledge_service, privacy_service

router = APIRouter(prefix="/api/v1/knowledge-bases", tags=["knowledge"])


def _kb_view(row) -> dict:
    return {
        "id": row.id, "name": row.name, "description": row.description,
        "embeddingProviderId": row.embedding_provider_id,
        "embeddingModel": row.embedding_model, "embeddingDim": row.embedding_dim,
        "collectionName": row.collection_name,
        "docCount": row.doc_count, "chunkCount": row.chunk_count,
        "indexStatus": row.index_status, "needsReindex": row.needs_reindex,
        "createdAt": row.created_at.isoformat() + "Z",
        "updatedAt": row.updated_at.isoformat() + "Z",
    }


def _doc_view(row) -> dict:
    return {
        "id": row.id, "kbId": row.kb_id, "filename": row.filename,
        "mime": row.mime, "sizeBytes": row.size_bytes, "sha256": row.sha256,
        "status": row.status, "error": row.error,
        "chunkCount": row.chunk_count, "pageCount": row.page_count,
        "ingestedMode": row.ingested_mode, "ingestedAt": row.ingested_at.isoformat() + "Z" if row.ingested_at else None,
        "createdAt": row.created_at.isoformat() + "Z",
    }


def _chunk_view(row) -> dict:
    return {
        "id": row.id, "docId": row.doc_id, "kbId": row.kb_id, "seq": row.seq,
        "content": row.content, "charLen": row.char_len, "tokenEst": row.token_est,
    }


def _require_kb(db: Session, kb_id: str):
    row = knowledge_repo.get_kb(db, kb_id)
    if row is None:
        raise NotFoundError("知识库不存在")
    return row


# ---------------------------- 知识库 CRUD ----------------------------

@router.get("")
def list_knowledge_bases(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                         db: Session = Depends(get_db)):
    rows, total = knowledge_repo.list_kbs(db, page=page, limit=limit)
    return ok({"items": [_kb_view(r) for r in rows], "total": total,
               "page": page, "limit": limit, "hasMore": page * limit < total})


@router.post("", status_code=201,
             summary="建库（strict 档阻断，code=4030）",
             dependencies=[Depends(require_privacy("kb_ingest"))])
def create_knowledge_base(payload: dict, db: Session = Depends(get_db)):
    name = (payload.get("name") or "").strip()
    if not name:
        raise ConflictError("知识库名称不能为空")
    if knowledge_repo.get_kb_by_name(db, name):
        raise ConflictError("同名知识库已存在")
    row = knowledge_repo.create_kb(db, {
        "name": name[:100],
        "description": payload.get("description"),
        "collection_name": f"kb_{uuid.uuid4()}",
    })
    db.commit()
    return ok(_kb_view(row))


@router.get("/{kb_id}")
def get_knowledge_base(kb_id: str, db: Session = Depends(get_db)):
    return ok(_kb_view(_require_kb(db, kb_id)))


@router.patch("/{kb_id}")
def update_knowledge_base(kb_id: str, payload: dict, db: Session = Depends(get_db)):
    kb = _require_kb(db, kb_id)
    fields = {}
    if payload.get("name"):
        fields["name"] = str(payload["name"])[:100]
    if "description" in payload:
        fields["description"] = payload["description"]
    if payload.get("embeddingProviderId") and payload["embeddingProviderId"] != kb.embedding_provider_id:
        # 换 embedding 模型 → 需要重建索引（AC 语义）
        fields["embedding_provider_id"] = payload["embeddingProviderId"]
        fields["embedding_model"] = payload.get("embeddingModel")
        fields["needs_reindex"] = True
    knowledge_repo.update_kb(db, kb, fields)
    db.commit()
    return ok(_kb_view(kb))


@router.delete("/{kb_id}")
def delete_knowledge_base(kb_id: str, db: Session = Depends(get_db)):
    knowledge_repo.soft_delete_kb(db, _require_kb(db, kb_id))
    db.commit()
    return ok({"archived": kb_id})


@router.get("/{kb_id}/stats")
def get_knowledge_base_stats(kb_id: str, db: Session = Depends(get_db)):
    kb = _require_kb(db, kb_id)
    docs, _ = knowledge_repo.list_documents(db, kb_id, limit=1000)
    by_status: dict[str, int] = {}
    for d in docs:
        by_status[d.status] = by_status.get(d.status, 0) + 1
    modes: dict[str, int] = {}
    for d in docs:
        if d.ingested_mode:
            modes[d.ingested_mode] = modes.get(d.ingested_mode, 0) + 1
    return ok({
        "docCount": kb.doc_count, "chunkCount": kb.chunk_count,
        "indexStatus": kb.index_status, "needsReindex": kb.needs_reindex,
        "docsByStatus": by_status,
        "docsByIngestedMode": modes,  # AC-28：按入库档位的筛选依据
    })


# ---------------------------- 文档 ----------------------------

@router.get("/{kb_id}/documents")
def list_documents(kb_id: str, page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=200),
                   status: str | None = Query(None), db: Session = Depends(get_db)):
    _require_kb(db, kb_id)
    rows, total = knowledge_repo.list_documents(db, kb_id, page=page, limit=limit, status=status)
    return ok({"items": [_doc_view(r) for r in rows], "total": total,
               "page": page, "limit": limit, "hasMore": page * limit < total})


@router.post("/{kb_id}/documents", status_code=201,
             summary="上传文档（pdf/docx/md/txt/csv；strict 档阻断）",
             dependencies=[Depends(require_privacy("kb_ingest"))])
async def upload_document(kb_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    kb = _require_kb(db, kb_id)
    data = await file.read()
    if not data:
        raise NotFoundError("空文件")
    mode = privacy_service.get_privacy_mode(db)
    doc = knowledge_service.ingest_document(
        db, kb, filename=file.filename or "unnamed.txt",
        mime=file.content_type, data=data, privacy_mode=mode,
    )
    return ok(_doc_view(doc))


@router.delete("/{kb_id}/documents/{doc_id}")
def delete_document(kb_id: str, doc_id: str, db: Session = Depends(get_db)):
    _require_kb(db, kb_id)
    doc = knowledge_repo.get_document(db, kb_id, doc_id)
    if doc is None:
        raise NotFoundError("文档不存在")
    knowledge_repo.delete_chunks_by_doc(db, kb_id, doc_id)
    knowledge_repo.soft_delete_document(db, doc)
    kb = knowledge_repo.get_kb(db, kb_id)
    knowledge_service._recompute_index_status(db, kb)
    db.commit()
    return ok({"deleted": doc_id})


@router.get("/{kb_id}/documents/{doc_id}/chunks")
def list_chunks(kb_id: str, doc_id: str, page: int = Query(1, ge=1),
                limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    _require_kb(db, kb_id)
    if knowledge_repo.get_document(db, kb_id, doc_id) is None:
        raise NotFoundError("文档不存在")
    rows, total = knowledge_repo.list_chunks(db, kb_id, doc_id, page=page, limit=limit)
    return ok({"items": [_chunk_view(r) for r in rows], "total": total,
               "page": page, "limit": limit, "hasMore": page * limit < total})


@router.post("/{kb_id}/documents/{doc_id}/reprocess",
             dependencies=[Depends(require_privacy("kb_ingest"))])
def reprocess_document(kb_id: str, doc_id: str, db: Session = Depends(get_db)):
    raise NotFoundError("reprocess 将在语义通道启用波次交付；当前 keyword 通道无需重嵌入")


# ---------------------------- 检索 / 重建 / 反馈 ----------------------------

@router.post("/{kb_id}/search",
             summary="检索（vector/keyword/hybrid；strict 档阻断）",
             dependencies=[Depends(require_privacy("kb_search"))])
def search_knowledge_base(kb_id: str, payload: dict, db: Session = Depends(get_db)):
    kb = _require_kb(db, kb_id)
    result = knowledge_service.search(
        db, kb,
        query=payload.get("query") or "",
        mode=payload.get("mode") or "keyword",
        top_k=payload.get("topK", 5),
        privacy_mode=privacy_service.get_privacy_mode(db),
    )
    return ok(result)


@router.post("/{kb_id}/reindex",
             dependencies=[Depends(require_privacy("kb_ingest"))])
def reindex_knowledge_base(kb_id: str, db: Session = Depends(get_db)):
    kb = _require_kb(db, kb_id)
    kb.needs_reindex = False
    kb.index_status = "building"
    added = knowledge_repo.index_chunks(db, kb_id)
    knowledge_service._recompute_index_status(db, kb)
    db.commit()
    return ok({"reindexed": True, "chunksIndexedDelta": added, "indexStatus": kb.index_status})


@router.post("/{kb_id}/queries/{query_id}/feedback")
def feedback_query(kb_id: str, query_id: str, payload: dict, db: Session = Depends(get_db)):
    _require_kb(db, kb_id)
    value = payload.get("feedback")
    row = knowledge_repo.set_feedback(db, kb_id, query_id, value if value is None else float(value))
    if row is None:
        raise NotFoundError("检索记录不存在")
    db.commit()
    return ok({"queryId": query_id, "feedback": row.feedback})
