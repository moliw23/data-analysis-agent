"""密钥安全：Fernet 加解密 + 掩码。

设计要点（docs/02-架构.md R6）：
- api_key 采用 Fernet 对称加密后存 llm_providers.api_key_enc；
- 密钥来源为环境变量 APP_SECRET_KEY（首次启动自动生成并写入 .env），禁止硬编码；
- api_key 只写不读：对外只暴露 api_key_hint（形如 sk-***abc）；
- 明文 Key 永不进日志、永不进响应。
"""

from __future__ import annotations

import logging

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

logger = logging.getLogger("app.security")


class KeyDecryptionError(Exception):
    """密文无法解密（密钥轮换或数据损坏）。"""


def _fernet() -> Fernet:
    settings = get_settings()
    if not settings.secret_key:
        raise KeyDecryptionError("APP_SECRET_KEY 未初始化")
    return Fernet(settings.secret_key.encode("utf-8"))


def encrypt_key(plain: str) -> str:
    """明文 -> Fernet 密文（str，便于落 SQLite TEXT 列）。"""
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_key(cipher: str) -> str:
    """密文 -> 明文。仅在 service 转发上游前调用，禁止外泄。"""
    try:
        return _fernet().decrypt(cipher.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError) as exc:
        raise KeyDecryptionError("API Key 解密失败") from exc


def mask_key(plain: str | None) -> str:
    """生成掩码：保留前 3 位 + 后 3 位，形如 sk-***abc。

    绝不含原文连续片段，确保响应中 grep 不到明文 Key（AC-06）。
    """
    if not plain:
        return ""
    key = plain.strip()
    if len(key) < 8:
        return "***"
    return f"{key[:3]}***{key[-3:]}"


def mask_cipher(cipher: str | None) -> str:
    """对密文求掩码（无法解密时用于降级展示，不泄漏任何明文）。"""
    if not cipher:
        return ""
    return "***"


__all__ = [
    "KeyDecryptionError",
    "decrypt_key",
    "encrypt_key",
    "mask_cipher",
    "mask_key",
]
