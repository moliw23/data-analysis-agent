"""应用入口 —— 只装配，零业务逻辑。

装配顺序（docs/02-架构.md §11.1，注册顺序是硬约束）：
  1) 异常处理器（保证任何异常都走统一信封）
  2) 中间件：RequestContext -> CORS
  3) /api/v1 路由（必须在静态挂载之前注册，否则被 StaticFiles 通配吞掉）
  4) SPA 静态托管（mount "/"，最后注册）
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import ROUTERS
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import setup_logging
from app.core.middleware import RequestContextMiddleware
from app.db import init_db

logger = logging.getLogger("app.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.log_level, settings.log_file_path)
    logger.info("starting %s v%s", settings.app_name, settings.app_version)
    init_db()
    logger.info("db ready at %s", settings.db_file)
    yield
    logger.info("shutdown complete")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="数据分析 Agent 本地服务 API",
        version=settings.app_version,
        lifespan=lifespan,
    )
    app.state.frontend_dist = str(settings.frontend_dist_path)

    register_exception_handlers(app)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization", "X-Local-Confirm", "X-Request-ID"],
        max_age=86400,
    )
    app.add_middleware(RequestContextMiddleware)

    for router in ROUTERS:
        app.include_router(router)

    _mount_spa(app, settings.frontend_dist_path)
    return app


def _mount_spa(app: FastAPI, dist: Path) -> None:
    """托管前端构建产物。目录不存在时跳过（纯后端开发模式）。"""
    if not dist.is_dir():
        logger.warning("frontend dist not found: %s (SPA 托管已跳过)", dist)
        return
    assets = dist / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")
    # 挂载在最后：未知路径 -> StaticFiles 404 -> 异常处理器回退 index.html
    app.mount("/", StaticFiles(directory=dist, html=True), name="spa")


app = create_app()
