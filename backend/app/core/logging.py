"""结构化日志 + request_id 注入 + 密钥脱敏。

铁律：任何日志都不得出现明文 API Key（AC-06）。
RedactFilter 在 formatter 之前改写 record.msg / args，覆盖 sk- 形态与 Authorization 头。
"""

from __future__ import annotations

import contextvars
import logging
import re
import uuid
from pathlib import Path
from typing import Any

# 当前请求 id（middleware 写入，日志 filter 与异常处理器读取）
request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default=""
)

# 明文密钥脱敏：sk-xxx / Bearer xxx / api_key=xxx
_SECRET_PATTERNS = [
    re.compile(r"(sk-[A-Za-z0-9_\-]{4})[A-Za-z0-9_\-]+"),
    re.compile(r"(Bearer\s+)[A-Za-z0-9_\-\.]+", re.IGNORECASE),
    re.compile(r"((?:api[_-]?key|apikey)[\"'=:\s]+)[A-Za-z0-9_\-]{6,}", re.IGNORECASE),
]


def redact(text: str) -> str:
    """把字符串中的密钥形态替换为掩码。"""
    out = text
    for i, pat in enumerate(_SECRET_PATTERNS):
        if i == 0:
            out = pat.sub(r"\1***", out)
        elif i == 1:
            out = pat.sub(r"\1***", out)
        else:
            out = pat.sub(r"\1***", out)
    return out


class RedactFilter(logging.Filter):
    """在输出前对 message 与 args 做脱敏。"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = redact(record.msg)
            if record.args:
                record.args = tuple(
                    redact(a) if isinstance(a, str) else a for a in record.args
                )
        except Exception:  # 脱敏失败不能影响业务日志
            pass
        return True


class RequestIdFilter(logging.Filter):
    """把 request_id 注入每条日志。"""

    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.request_id = request_id_var.get() or "-"
        return True


_LOG_FORMAT = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s %(message)s"


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


def setup_logging(level: str = "INFO", log_file: Path | None = None) -> None:
    """配置根 logger：控制台 + 可选文件（轮转为改名，不做删除）。"""
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    formatter = logging.Formatter(_LOG_FORMAT)
    filters: list[logging.Filter] = [RedactFilter(), RequestIdFilter()]

    for handler in list(root.handlers):
        root.removeHandler(handler)

    console = logging.StreamHandler()
    console.setFormatter(formatter)
    for f in filters:
        console.addFilter(f)
    root.addHandler(console)

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(log_file, encoding="utf-8")
        file_handler.setFormatter(formatter)
        for f in filters:
            file_handler.addFilter(f)
        root.addHandler(file_handler)

    # uvicorn 的 access 日志走同一套 filter（避免它绕过脱敏）
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).addFilter(RedactFilter())


def log_event(logger: logging.Logger, event: str, **fields: Any) -> None:
    """结构化事件日志：字段以 key=value 拼接，值经脱敏。"""
    parts = " ".join(f"{k}={redact(str(v))}" for k, v in fields.items() if v is not None)
    logger.info("%s %s", event, parts)
