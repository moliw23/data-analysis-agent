"""数据集与只读 SQL 端点（P2-6a 全量；闸门语义与 F0 波次一致，strict/standard 4030）。

storageMode 语义（Spec F7）：local = 服务端不存明细（登记返回 4090，由前端引擎管理）；
server = full 档下登记元数据 + multipart 上传明细落服务端 SQLite；/query 受 server_sql 闸门。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_db, require_privacy
from app.core.errors import ConflictError, NotFoundError
from app.db import get_engine
from app.schemas.common import ok
from app.schemas.dataset import DatasetRegisterRequest
from app.services import dataset_service, privacy_service

router = APIRouter(prefix="/api/v1/datasets", tags=["datasets"])


def _view(row) -> dict:
    import json

    return {
        "id": row.id, "name": row.name, "sourceType": row.source_type,
        "storageMode": row.storage_mode, "serverTable": row.server_table,
        "rowCount": row.row_count, "columnCount": row.column_count,
        "schema": json.loads(row.schema_json) if row.schema_json else [],
        "sha256": row.sha256,
        "createdAt": row.created_at.isoformat() + "Z",
    }


@router.get("")
def list_datasets(page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
                  db: Session = Depends(get_db)):
    from sqlalchemy import func, select

    from app.models.dataset import Dataset

    conds = [Dataset.deleted_at.is_(None)]
    total = db.execute(select(func.count()).select_from(Dataset).where(*conds)).scalar_one()
    rows = list(db.execute(
        select(Dataset).where(*conds).order_by(Dataset.created_at.desc())
        .offset((page - 1) * limit).limit(limit)
    ).scalars())
    return ok({"items": [_view(r) for r in rows], "total": int(total),
               "page": page, "limit": limit, "hasMore": page * limit < total})


@router.post("", status_code=201,
             summary="登记数据集元数据（storageMode=server 受 full 档闸门；local 返回 4090）")
async def create_dataset(payload: DatasetRegisterRequest, db: Session = Depends(get_db)):
    storage_mode = payload.storage_mode
    if storage_mode == "server":
        privacy_service.enforce_capability(db, "server_dataset_register")
    else:
        # local 模式：服务端不存明细（F7 语义），登记无意义，如实拒绝
        raise ConflictError("本地模式数据集由前端引擎管理，服务端不登记（storageMode=local）")
    ds = dataset_service.register_dataset_meta(
        db, name=payload.name,
        row_count=int(payload.row_count or 0),
    )
    db.commit()
    return ok(_view(ds))


@router.post("/{dataset_id}/upload", status_code=201,
             summary="上传明细 CSV 到服务端（strict/standard 阻断 4030）",
             dependencies=[Depends(require_privacy("server_sql"))])
async def upload_dataset(dataset_id: str,
                         file: UploadFile | None = File(None),
                         db: Session = Depends(get_db)):
    ds = dataset_service.get_dataset(db, dataset_id)
    if file is None:
        raise ConflictError("请使用 multipart/form-data 上传 CSV 文件")
    data = await file.read()
    if not data:
        raise ConflictError("空文件")
    dataset_service.load_csv(db, ds, csv_data=data)
    db.commit()
    return ok(_view(ds))


@router.get("/{dataset_id}")
def get_dataset(dataset_id: str, db: Session = Depends(get_db)):
    return ok(_view(dataset_service.get_dataset(db, dataset_id)))


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str, db: Session = Depends(get_db)):
    ds = dataset_service.get_dataset(db, dataset_id)
    dataset_service.delete_dataset_table(db, ds)
    db.commit()
    return ok({"archived": dataset_id})


@router.post("/{dataset_id}/query",
             summary="服务端只读 SQL（strict/standard 阻断 4030；DDL/DML 拦截并给原因）",
             dependencies=[Depends(require_privacy("server_sql"))])
def query_dataset(dataset_id: str, payload: dict, db: Session = Depends(get_db)):
    ds = dataset_service.get_dataset(db, dataset_id)
    sql = (payload.get("sql") or "").strip()
    if not sql:
        raise ConflictError("SQL 为空")
    ok_flag, reason = dataset_service.validate_sql(sql)
    if not ok_flag:
        raise ConflictError(f"SQL 被拦截：{reason}")
    result = dataset_service.execute_readonly(get_engine(), sql)
    return ok(result)


@router.post("/sql/validate",
             summary="SQL 静态校验（不执行，返回拦截原因）",
             dependencies=[Depends(require_privacy("server_sql"))])
def validate_sql(payload: dict, db: Session = Depends(get_db)):
    ok_flag, reason = dataset_service.validate_sql(payload.get("sql") or "")
    return ok({"valid": ok_flag, "reason": reason})


@router.get("/{dataset_id}/preview")
def preview_dataset(dataset_id: str, limit: int = Query(20, ge=1, le=200),
                    db: Session = Depends(get_db)):
    ds = dataset_service.get_dataset(db, dataset_id)
    if not ds.server_table:
        raise ConflictError("尚未上传明细或本地存储模式无服务端明细")
    result = dataset_service.execute_readonly(
        get_engine(), f'SELECT * FROM "{ds.server_table}" LIMIT {limit}'
    )
    return ok(result)
