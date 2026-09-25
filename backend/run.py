"""启动入口：python run.py

workers=1 是硬约束（docs/02-架构.md §12 R5）：
APScheduler 多进程会重复触发任务，Chroma 官方声明非进程安全。
--reload 由 APP_RELOAD=1 控制，生产必须为 0（reload 会起子进程，同样违规）。
"""

from __future__ import annotations

import uvicorn

from app.core.config import get_settings


def main() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        workers=1,
        reload=settings.reload,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    main()
