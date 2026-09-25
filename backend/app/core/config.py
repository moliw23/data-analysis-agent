"""应用配置：唯一读取环境变量的地方（APP_ 前缀）。

铁律：配置与密钥只在 core/config.py + core/security.py 出现，禁止散落各处。
见 docs/02-架构.md §5.1 硬规则 8。
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# backend/ 目录（本文件位于 backend/app/core/config.py，向上三级）
BACKEND_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BACKEND_DIR / ".env"


class Settings(BaseSettings):
    """全部配置项。字段名小写，环境变量名大写下划线 + APP_ 前缀。"""

    model_config = SettingsConfigDict(
        env_prefix="APP_",
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "data-analysis-agent-backend"
    app_version: str = "1.0.0"

    host: str = "127.0.0.1"
    port: int = 8000

    # Fernet 密钥；留空时由 ensure_secret_key() 首次启动生成并写回 .env
    secret_key: str = ""

    db_path: str = "data/app.db"
    frontend_dist: str = "../dist"

    privacy_mode: str = "strict"

    log_level: str = "INFO"
    log_file: str = "data/logs/app.log"

    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:8000"
    )

    llm_timeout_seconds: float = 15.0
    llm_max_attempts: int = 2
    breaker_fail_threshold: int = 3
    breaker_cooldown_seconds: int = 60

    reload: bool = False

    # ---- 派生路径（全部绝对化，基于 backend/ 目录）----
    @property
    def db_file(self) -> Path:
        return self._resolve(self.db_path)

    @property
    def log_file_path(self) -> Path | None:
        if not self.log_file:
            return None
        return self._resolve(self.log_file)

    @property
    def frontend_dist_path(self) -> Path:
        return self._resolve(self.frontend_dist)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def _resolve(self, raw: str) -> Path:
        p = Path(raw)
        return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


def ensure_secret_key(settings: Settings) -> str:
    """首次启动生成 Fernet 密钥并写入 .env；已存在则原样返回。

    禁止硬编码密钥；密钥文件/环境变量与数据库解耦，可分别保护。
    """
    if settings.secret_key:
        return settings.secret_key

    from cryptography.fernet import Fernet

    new_key = Fernet.generate_key().decode("utf-8")
    _write_env_value("APP_SECRET_KEY", new_key)
    settings.secret_key = new_key
    return new_key


def _write_env_value(key: str, value: str) -> None:
    """把 key=value 写回 .env（不存在则从 .env.example 复制骨架，再替换/追加）。

    注意：不做任何文件删除，只做"读-改-覆盖写"。
    """
    lines: list[str] = []
    if ENV_FILE.is_file():
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    elif (BACKEND_DIR / ".env.example").is_file():
        lines = (BACKEND_DIR / ".env.example").read_text(encoding="utf-8").splitlines()

    replaced = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{key}={value}")

    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """进程级单例配置。"""
    s = Settings()
    if not s.secret_key and not os.environ.get("APP_SECRET_KEY"):
        ensure_secret_key(s)
    return s
