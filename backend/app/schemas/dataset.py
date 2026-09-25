"""数据集相关的请求模型。

★ F0 请求体级闸门的关键设计（docs/02-架构.md §7.4.2 第 ② 类）：
`DatasetRegisterRequest` **刻意不含 rows / data 字段** —— 登记端点从接口签名层面
就无法接收明细行，判定不靠运行时 if 兜底。明细行的唯一入口是
`POST /datasets/{id}/upload`（multipart 文件，受 server_sql 闸门管控）。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class DatasetRegisterRequest(BaseModel):
    """POST /api/v1/datasets 的请求体（仅元数据，无明细行）。"""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    source_type: Literal["file", "api", "db"] = Field(
        default="file", alias="sourceType"
    )
    storage_mode: Literal["local", "server"] = Field(
        default="local", alias="storageMode"
    )
    row_count: int | None = Field(default=None, ge=0, alias="rowCount")
    sha256: str | None = None
    schema_def: dict[str, Any] | None = Field(default=None, alias="schema")


class DatasetQueryRequest(BaseModel):
    """POST /api/v1/datasets/{id}/query 的请求体。"""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    sql: str = Field(min_length=1, max_length=20000)
    limit: int = Field(default=1000, ge=1, le=5000)
