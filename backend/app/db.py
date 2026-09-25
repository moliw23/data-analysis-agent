"""数据库：engine / SessionLocal / init_db + PRAGMA（WAL / busy_timeout / foreign_keys）。

配置沿用 job-tracker 已验证组合（docs/02-架构.md §12 R4）：
  PRAGMA journal_mode=WAL        —— APScheduler 后台线程 + 请求线程并发写
  PRAGMA busy_timeout=5000       —— 写锁等待而非立刻报 database is locked
  PRAGMA foreign_keys=ON         —— 级联删除语义生效
  check_same_thread=False        —— 允许跨线程复用连接
MVP 不用 Alembic：create_all 幂等 + 启动时列检查补列（§12 R7）。
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.models import Base

logger = logging.getLogger("app.db")

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def _apply_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=5000")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA synchronous=NORMAL")
    finally:
        cur.close()


def get_engine() -> Engine:
    """进程级单例 engine。"""
    global _engine
    if _engine is None:
        settings = get_settings()
        db_file: Path = settings.db_file
        db_file.parent.mkdir(parents=True, exist_ok=True)
        _engine = create_engine(
            f"sqlite:///{db_file.as_posix()}",
            echo=False,
            future=True,
            connect_args={"check_same_thread": False},
        )
        event.listen(_engine, "connect", _apply_pragmas)
    return _engine


def get_sessionmaker() -> sessionmaker[Session]:
    global _SessionLocal
    if _SessionLocal is None:
        _SessionLocal = sessionmaker(
            bind=get_engine(), autoflush=False, autocommit=False, future=True
        )
    return _SessionLocal


def session_scope() -> Iterator[Session]:
    """手动管理事务的场景用（调度线程 / 脚本）。"""
    session = get_sessionmaker()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


_SUPPORTED_DDL: dict[str, str] = {
    "VARCHAR": "VARCHAR",
    "TEXT": "TEXT",
    "INTEGER": "INTEGER",
    "BOOLEAN": "BOOLEAN",
    "DATETIME": "DATETIME",
    "FLOAT": "FLOAT",
}


def _column_ddl(col) -> str:
    """生成 ALTER TABLE ADD COLUMN 用的类型片段（只处理可空列）。"""
    try:
        type_name = col.type.__class__.__name__.upper()
        base = _SUPPORTED_DDL.get(type_name, "TEXT")
        if base == "VARCHAR":
            length = getattr(col.type, "length", None) or 255
            base = f"VARCHAR({length})"
        return base
    except Exception:
        return "TEXT"


def _ensure_columns(engine: Engine) -> list[str]:
    """轻量迁移：对已存在表补上缺失的可空列（SQLite 支持 ADD COLUMN）。

    只加列、不改列、不删列 —— 与"禁止删除步骤"的环境约束一致。
    """
    added: list[str] = []
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            if table.name not in existing_tables:
                continue
            have = {c["name"] for c in inspector.get_columns(table.name)}
            for col in table.columns:
                if col.name in have:
                    continue
                if not col.nullable and col.default is None and col.server_default is None:
                    logger.warning(
                        "skip non-nullable new column %s.%s (需手工迁移)",
                        table.name,
                        col.name,
                    )
                    continue
                ddl = _column_ddl(col)
                conn.execute(
                    text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}')
                )
                added.append(f"{table.name}.{col.name}")
    return added


def init_db() -> None:
    """建表（幂等）+ 补列。数据库文件不存在即新建，不做任何删除。"""
    engine = get_engine()
    Base.metadata.create_all(engine)
    added = _ensure_columns(engine)
    if added:
        logger.info("schema 补列完成: %s", ", ".join(added))


def check_db() -> bool:
    """health 用：真实探测数据库可读。"""
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:  # pragma: no cover - 仅在极端环境下触发
        logger.warning("db probe failed: %s", exc)
        return False


def reset_state_for_tests() -> None:
    """测试专用：丢弃缓存的 engine/sessionmaker（不删除任何文件）。"""
    global _engine, _SessionLocal
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _SessionLocal = None
