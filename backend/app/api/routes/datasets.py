"""数据集与只读 SQL 端点 —— 本波只落 F0 闸门，业务实现见后续波次（P2-6）。

两个闸门键：
  server_dataset_register —— 请求体级（storageMode='server' 时判定，② 类消费点）
  server_sql              —— 路由级（明细上传 / 服务端 SQL 查询，① 类消费点）

strict / standard 下 storageMode='server' 注册与明细上传均返回 4030；
strict 档下签名层即拒绝明细行（DatasetRegisterRequest 无 rows 字段，extra='forbid'）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_privacy
from app.core.errors import ConflictError
from app.schemas.dataset import DatasetQueryRequest, DatasetRegisterRequest
from app.services import privacy_service

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])

_PENDING_MESSAGE = (
    "数据集服务端存储与 SQL 执行业务将在后续波次交付；本波已完成 F0 闸门接入。"
)


@router.post("", summary="登记数据集元数据（storageMode=server 受闸门管控）")
def create_dataset(
    payload: DatasetRegisterRequest, db: Session = Depends(get_db)
) -> dict:
    # ② 请求体级闸门：同一端点因 storageMode 取值不同而判定不同
    if payload.storage_mode == "server":
        privacy_service.enforce_capability(db, "server_dataset_register")
    raise ConflictError(_PENDING_MESSAGE)


@router.post(
    "/{dataset_id}/upload",
    summary="上传明细到服务端（standard/strict 阻断，code=4030）",
    dependencies=[Depends(require_privacy("server_sql"))],
)
def upload_dataset(dataset_id: str) -> dict:
    raise ConflictError(_PENDING_MESSAGE)


@router.post(
    "/{dataset_id}/query",
    summary="服务端只读 SQL（standard/strict 阻断，code=4030）",
    dependencies=[Depends(require_privacy("server_sql"))],
)
def query_dataset(dataset_id: str, payload: DatasetQueryRequest) -> dict:
    raise ConflictError(_PENDING_MESSAGE)
