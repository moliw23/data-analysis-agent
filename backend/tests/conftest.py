"""pytest 共享夹具。

关键点：每个测试用独立的临时 SQLite（不触碰 backend/data/app.db），
且不执行任何文件删除动作。
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

_TMP_DIR = Path(tempfile.mkdtemp(prefix="da_backend_test_"))

# 必须在导入 app.* 之前设置环境变量（pydantic-settings 在导入期读取）
os.environ["APP_DB_PATH"] = str(_TMP_DIR / "test.db")
os.environ["APP_LOG_FILE"] = ""
os.environ["APP_LOG_LEVEL"] = "WARNING"
os.environ["APP_CORS_ORIGINS"] = "http://127.0.0.1:8000"
os.environ["APP_RELOAD"] = "0"
# 固定测试密钥，避免写入仓库外的 .env
os.environ.setdefault(
    "APP_SECRET_KEY", "kQ0mZx2v8bN1sT4yL7rJ0cF6pW9aH3dE5gU2iO8nQ4k="
)

from fastapi.testclient import TestClient  # noqa: E402

from app.core.config import get_settings  # noqa: E402
from app.db import init_db, reset_state_for_tests  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services import llm_service  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _prepare_db():
    get_settings.cache_clear()
    reset_state_for_tests()
    init_db()
    yield


@pytest.fixture()
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _clean_state():
    """每个测试前清空业务表与熔断状态，保证互不干扰。"""
    from app.db import get_engine
    from app.models import Base

    with get_engine().begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    llm_service.reset_breakers()
    yield


CONFIRM = {"X-Local-Confirm": "true"}


def provider_payload(name: str = "p1", key: str = "sk-testPLAINTEXTKEY123456") -> dict:
    return {
        "name": name,
        "baseUrl": "https://api.example.com",
        "apiKey": key,
        "model": "test-model",
    }
