"""依赖注入：db session / request_id / 隐私闸门 / 本机确认。

require_privacy(capability) 是 §7.4.2 第 ① 类消费点（路由级闸门）。
铁律：调用处必须传 **capability 键**，由 core/privacy.py 内部查 CAPABILITY_GATES，
不得写成 require_privacy("standard", "full") 这类字面量档位元组。
"""

from __future__ import annotations

from collections.abc import Callable, Generator

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.core.errors import LocalConfirmRequiredError
from app.db import get_sessionmaker
from app.services import privacy_service


def get_db() -> Generator[Session, None, None]:
    """请求级 session。"""
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


def get_request_id(request: Request) -> str:
    return getattr(request.state, "request_id", "") or ""


def require_privacy(capability: str) -> Callable[[Session], None]:
    """路由级闸门工厂。

    用法：router.post("/x", dependencies=[Depends(require_privacy("kb_ingest"))])
    被阻断时抛 core.errors.PrivacyBlockedError -> 全局处理器返回 code=4030。
    """

    def _gate(db: Session = Depends(get_db)) -> None:
        policy = privacy_service.get_policy(db)
        policy.raise_if_blocked(
            capability, privacy_service.blocked_counts(db, policy.mode)
        )

    return _gate


def require_local_confirm(
    x_local_confirm: str | None = Header(default=None, alias="X-Local-Confirm"),
) -> None:
    """写密钥 / 不可逆操作需 X-Local-Confirm: true（防 CSRF 与误点）。"""
    if (x_local_confirm or "").strip().lower() != "true":
        raise LocalConfirmRequiredError()


def get_policy(db: Session = Depends(get_db)):
    return privacy_service.get_policy(db)


__all__ = [
    "get_db",
    "get_policy",
    "get_request_id",
    "require_local_confirm",
    "require_privacy",
]
