"""统一响应信封与分页模型（供 OpenAPI 文档与类型对照）。

实际响应由 core/errors.py::envelope() 构造为 dict；
本文件提供等价的 Pydantic 模型，作为契约镜像与文档来源。
"""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """{ code, message, data, request_id }。code=0 表示成功。"""

    code: int = Field(default=0, description="0 表示成功，非 0 见业务错误码表")
    message: str = Field(default="ok")
    data: T | None = None
    request_id: str = Field(default="", description="服务端生成的请求追踪 id")


class PageData(BaseModel, Generic[T]):
    """分页载荷，置于 data 内。"""

    items: list[T] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    limit: int = 20
    hasMore: bool = False


def ok(data: Any = None, message: str = "ok") -> dict[str, Any]:
    from app.core.errors import envelope

    return envelope(0, data, message)


def page_payload(
    items: list[Any], total: int, page: int, limit: int
) -> dict[str, Any]:
    return {
        "items": items,
        "total": int(total),
        "page": int(page),
        "limit": int(limit),
        "hasMore": page * limit < int(total),
    }


__all__ = ["ApiResponse", "PageData", "ok", "page_payload"]
