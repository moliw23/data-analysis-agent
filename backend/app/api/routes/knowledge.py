"""RAG 知识库端点 —— 本波只落 F0 闸门，业务实现见后续波次（P2-5）。

为什么现在就有这个文件：闸门必须与其守护的能力同时诞生（docs/02-架构.md §13）。
若留到功能做完再补闸门，中间每一次试跑都是"无闸门"状态 —— 对一个隐私承诺类功能，
这段窗口本身就是缺陷。

本波范围声明：仅接入 kb_ingest / kb_search 两个闸门；
上传 / 切分 / 嵌入 / 检索的业务实现在后续波次交付，
放行档位下如实返回 code=4090（不伪造成功，禁止静默降级）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_privacy
from app.core.errors import ConflictError

router = APIRouter(prefix="/api/v1/knowledge-bases", tags=["knowledge"])

_PENDING_MESSAGE = (
    "RAG 知识库业务实现将在后续波次交付；本波已完成 F0 闸门接入"
    "（strict 档下该入口返回 4030）。"
)


def _pending() -> dict:
    raise ConflictError(_PENDING_MESSAGE)


@router.post(
    "",
    summary="建库（strict 档阻断，code=4030）",
    dependencies=[Depends(require_privacy("kb_ingest"))],
)
def create_knowledge_base() -> dict:
    return _pending()


@router.post(
    "/{kb_id}/documents",
    summary="上传文档（strict 档阻断，code=4030）",
    dependencies=[Depends(require_privacy("kb_ingest"))],
)
def upload_document(kb_id: str) -> dict:
    return _pending()


@router.post(
    "/{kb_id}/documents/{doc_id}/reprocess",
    summary="重新切分与嵌入（strict 档阻断，code=4030）",
    dependencies=[Depends(require_privacy("kb_ingest"))],
)
def reprocess_document(kb_id: str, doc_id: str) -> dict:
    return _pending()


@router.post(
    "/{kb_id}/reindex",
    summary="重建索引（strict 档阻断，code=4030）",
    dependencies=[Depends(require_privacy("kb_ingest"))],
)
def reindex(kb_id: str) -> dict:
    return _pending()


@router.post(
    "/{kb_id}/search",
    summary="检索（strict 档阻断，code=4030）",
    dependencies=[Depends(require_privacy("kb_search"))],
)
def search(kb_id: str) -> dict:
    return _pending()
