"""ASGI 中间件：request_id 注入 + 访问日志。

为什么用纯 ASGI 中间件而非 BaseHTTPMiddleware：
contextvars 在 BaseHTTPMiddleware 里于独立 task 中执行下游，set 的值传不到路由；
纯 ASGI 中间件在同一 task 内 await，contextvar 可正确传播给端点与异常处理器。
"""

from __future__ import annotations

import logging
import time

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.logging import new_request_id, request_id_var

logger = logging.getLogger("app.access")

_EXCLUDED_PREFIXES = ("/assets/", "/docs", "/openapi.json", "/redoc")


class RequestContextMiddleware:
    """为每个请求生成/透传 X-Request-ID，注入日志上下文并记录访问日志。"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        rid = _header(scope, b"x-request-id") or new_request_id()
        state = scope.setdefault("state", {})
        state["request_id"] = rid
        token = request_id_var.set(rid)
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                MutableHeaders(scope=message)["X-Request-ID"] = rid
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            path = scope.get("path", "")
            if not path.startswith(_EXCLUDED_PREFIXES):
                logger.info(
                    "%s %s -> %s %dms",
                    scope.get("method", "-"),
                    path,
                    status_holder["status"],
                    elapsed_ms,
                )
            request_id_var.reset(token)


def _header(scope: Scope, name: bytes) -> str | None:
    for key, value in scope.get("headers", []):
        if key.lower() == name:
            try:
                return value.decode("latin-1")
            except UnicodeDecodeError:
                return None
    return None
