"""业务异常体系 + 全局异常处理器（统一信封）+ SPA 回退。

统一响应信封：{ "code": 0, "message": "ok", "data": {...}, "request_id": "..." }
任何异常（含 422 校验错与未捕获异常）都必须返回这个信封，
绝不能漏出 FastAPI 默认的 {"detail": ...}。

业务错误码（Spec §5.2 + 任务书锁定）：
  0    成功
  4000 参数校验失败        HTTP 422
  4010 未配置 LLM Provider HTTP 400
  4011 缺少本机确认头       HTTP 403（openapi 原文写 4010，与"未配 Provider"撞码，
                              此处刻意改用 4011 消歧，见交付说明 advisory）
  4020 上游 LLM 调用失败    HTTP 502
  4030 被隐私档位阻断       HTTP 403
  4040 资源不存在           HTTP 404
  4090 状态冲突             HTTP 409
  4091 索引未就绪           HTTP 409
  4290 限流                 HTTP 429
  5000 服务端内部错误       HTTP 500
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

logger = logging.getLogger("app.errors")

# ---- 错误码常量 ----
CODE_OK = 0
CODE_VALIDATION = 4000
CODE_PROVIDER_NOT_CONFIGURED = 4010
CODE_LOCAL_CONFIRM_REQUIRED = 4011
CODE_UPSTREAM_FAILED = 4020
CODE_PRIVACY_BLOCKED = 4030
CODE_NOT_FOUND = 4040
CODE_CONFLICT = 4090
CODE_INDEX_NOT_READY = 4091
CODE_RATE_LIMITED = 4290
CODE_INTERNAL = 5000

_HTTP_STATUS_MAP: dict[int, int] = {
    CODE_VALIDATION: 422,
    CODE_PROVIDER_NOT_CONFIGURED: 400,
    CODE_LOCAL_CONFIRM_REQUIRED: 403,
    CODE_UPSTREAM_FAILED: 502,
    CODE_PRIVACY_BLOCKED: 403,
    CODE_NOT_FOUND: 404,
    CODE_CONFLICT: 409,
    CODE_INDEX_NOT_READY: 409,
    CODE_RATE_LIMITED: 429,
    CODE_INTERNAL: 500,
}


def envelope(
    code: int = CODE_OK,
    data: Any = None,
    message: str = "",
    request_id: str | None = None,
) -> dict[str, Any]:
    """构造统一响应信封。"""
    rid = request_id or request_id_var.get() or uuid.uuid4().hex[:16]
    return {
        "code": code,
        "data": data,
        "message": message or ("ok" if code == CODE_OK else ""),
        "request_id": rid,
    }


class AppError(Exception):
    """全部业务异常的基类。service 层只抛本类，不抛 HTTPException。"""

    code: int = CODE_INTERNAL
    default_message: str = "Internal server error"

    def __init__(
        self,
        message: str | None = None,
        *,
        data: Any = None,
        code: int | None = None,
        http_status: int | None = None,
    ) -> None:
        self.code = code if code is not None else type(self).code
        self.message = message or self.default_message
        self.data = data
        self.http_status = (
            http_status
            if http_status is not None
            else _HTTP_STATUS_MAP.get(self.code, 500)
        )
        super().__init__(self.message)


class ValidationError(AppError):
    code = CODE_VALIDATION
    default_message = "请求参数校验失败"


class ProviderNotConfiguredError(AppError):
    code = CODE_PROVIDER_NOT_CONFIGURED
    default_message = (
        "未配置任何 LLM Provider。请在 设置 - 模型接入 中新增供应商"
        "（POST /api/v1/llm/providers），或检查 llm_routes 路由表是否可用。"
    )


class LocalConfirmRequiredError(AppError):
    code = CODE_LOCAL_CONFIRM_REQUIRED
    default_message = "该操作需要请求头 X-Local-Confirm: true"


class UpstreamError(AppError):
    code = CODE_UPSTREAM_FAILED
    default_message = "上游 LLM 调用失败"


class PrivacyBlockedError(AppError):
    code = CODE_PRIVACY_BLOCKED
    default_message = "当前隐私档位不允许该操作"


class NotFoundError(AppError):
    code = CODE_NOT_FOUND
    default_message = "资源不存在"


class ConflictError(AppError):
    code = CODE_CONFLICT
    default_message = "状态冲突"


class IndexNotReadyError(AppError):
    code = CODE_INDEX_NOT_READY
    default_message = "索引未就绪"


class RateLimitedError(AppError):
    code = CODE_RATE_LIMITED
    default_message = "请求过于频繁"


class InternalError(AppError):
    code = CODE_INTERNAL
    default_message = "服务端内部错误"


# ---------------------------- 全局处理器 ----------------------------


async def app_error_handler(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    if exc.code >= 5000:
        logger.exception("app error: %s", exc.message)
    else:
        logger.info("app error: code=%s message=%s", exc.code, exc.message)
    return JSONResponse(
        status_code=exc.http_status,
        content=envelope(exc.code, exc.data, exc.message),
    )


async def validation_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """Pydantic / FastAPI 校验失败 -> 统一信封，code=4000，HTTP 422。"""
    assert isinstance(exc, RequestValidationError)
    errors = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
        errors.append({"field": loc or "body", "reason": err.get("msg", "")})
    return JSONResponse(
        status_code=422,
        content=envelope(
            CODE_VALIDATION, {"errors": errors}, "请求参数校验失败"
        ),
    )


_HTTP_TO_CODE: dict[int, int] = {
    400: CODE_VALIDATION,
    401: CODE_LOCAL_CONFIRM_REQUIRED,
    403: CODE_LOCAL_CONFIRM_REQUIRED,
    404: CODE_NOT_FOUND,
    405: CODE_CONFLICT,
    409: CODE_CONFLICT,
    422: CODE_VALIDATION,
    429: CODE_RATE_LIMITED,
}


async def http_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Starlette HTTPException：非 /api 的 404 回退 SPA index.html，其余转信封。"""
    assert isinstance(exc, StarletteHTTPException)
    path = request.url.path
    if exc.status_code == 404 and not path.startswith(
        ("/api/", "/docs", "/openapi.json", "/redoc")
    ):
        index = _spa_index(request)
        if index is not None:
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
    code = _HTTP_TO_CODE.get(exc.status_code, 5000 if exc.status_code >= 500 else 4000)
    return JSONResponse(
        status_code=exc.status_code,
        content=envelope(code, None, str(exc.detail or "HTTP error")),
    )


async def unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """未捕获异常 -> 5000，日志记 stack，响应不泄漏细节。"""
    logger.exception("unhandled exception on %s", request.url.path)
    return JSONResponse(
        status_code=500, content=envelope(CODE_INTERNAL, None, "服务端内部错误")
    )


def _spa_index(request: Request) -> Path | None:
    dist = getattr(request.app.state, "frontend_dist", None)
    if not dist:
        return None
    index = Path(dist) / "index.html"
    return index if index.is_file() else None


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
