"""F1 LLM 网关：4010 / 密钥掩码 / Token NULL 语义 / fallback 双日志 / 统计口径。

上游用脚本化的 FakeClient 替换 httpx.AsyncClient，不发起真实网络请求。
"""

from __future__ import annotations

import json

import httpx
import pytest

from tests.conftest import CONFIRM, provider_payload

PLAINTEXT = "sk-testPLAINTEXTKEY123456"


class FakeResponse:
    def __init__(self, status_code: int = 200, payload: dict | None = None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text or (json.dumps(payload) if payload is not None else "")

    def json(self):
        if self._payload is None:
            raise ValueError("no json body")
        return self._payload


class FakeClient:
    """脚本队列：每次 post 弹出下一个响应或异常。"""

    script: list = []

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "FakeClient":
        return self

    async def __aexit__(self, *exc_info) -> bool:
        return False

    async def post(self, url, headers=None, json=None):  # noqa: A002
        if not FakeClient.script:
            raise AssertionError("FakeClient 脚本已空，测试脚本与调用次数不匹配")
        item = FakeClient.script.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


@pytest.fixture()
def fake_httpx(monkeypatch):
    FakeClient.script = []
    monkeypatch.setattr("app.services.llm_service.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr("app.services.provider_service.httpx.AsyncClient", FakeClient)
    yield FakeClient
    FakeClient.script = []


def _create_provider(client, name="p1") -> str:
    resp = client.post(
        "/api/v1/llm/providers", json=provider_payload(name, PLAINTEXT), headers=CONFIRM
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]["id"]


def _ok_payload(content: str = '{"ok":true}', usage: dict | None = None) -> dict:
    payload = {"choices": [{"message": {"role": "assistant", "content": content}}]}
    if usage is not None:
        payload["usage"] = usage
    return payload


# ---------------------------- 4010 ----------------------------
def test_chat_without_provider_returns_4010(client):
    resp = client.post(
        "/api/v1/llm/chat",
        json={"task_key": "text_to_sql", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == 4010
    # message 必须指明配置入口
    assert "llm/providers" in body["message"]


# ---------------------------- AC-06 密钥掩码 ----------------------------
def test_provider_key_is_masked_and_never_leaks(client):
    pid = _create_provider(client)

    listing = client.get("/api/v1/llm/providers")
    assert listing.status_code == 200
    text = listing.text
    assert PLAINTEXT not in text
    assert "api_key_enc" not in text
    items = listing.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["apiKeyHint"] == "sk-***456"
    assert items[0]["apiKeyHint"] != PLAINTEXT

    detail = client.get(f"/api/v1/llm/providers/{pid}")
    assert PLAINTEXT not in detail.text
    assert "api_key_enc" not in detail.text

    logs = client.get("/api/v1/llm/logs")
    assert PLAINTEXT not in logs.text

    # 落库的是密文而非明文
    from app.db import get_sessionmaker
    from app.models.llm import LlmProvider

    with get_sessionmaker()() as db:
        row = db.get(LlmProvider, pid)
        assert row.api_key_enc != PLAINTEXT
        assert PLAINTEXT not in row.api_key_enc
        assert row.api_key_hint == "sk-***456"


def test_duplicate_provider_name_conflicts(client):
    _create_provider(client, "dup")
    resp = client.post(
        "/api/v1/llm/providers", json=provider_payload("dup"), headers=CONFIRM
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == 4090


# ---------------------------- AC-05 usage / NULL ----------------------------
def test_chat_success_records_usage_and_log(client, fake_httpx):
    _create_provider(client)
    fake_httpx.script.append(
        FakeResponse(
            200,
            _ok_payload(
                '{"charts":[]}',
                {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18},
            ),
        )
    )
    resp = client.post(
        "/api/v1/llm/chat",
        json={"task_key": "plan_analysis", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["content"] == '{"charts":[]}'
    assert data["mode"] == "llm"
    assert data["usage"] == {
        "promptTokens": 11,
        "completionTokens": 7,
        "totalTokens": 18,
    }
    assert data["latencyMs"] >= 0

    log = client.get("/api/v1/llm/logs").json()["data"]["items"][0]
    assert log["status"] == "ok"
    assert log["taskKey"] == "plan_analysis"
    assert log["promptTokens"] == 11
    assert log["totalTokens"] == 18
    assert log["requestId"]


def test_usage_absent_writes_null_not_zero(client, fake_httpx):
    """上游未返回 usage 时必须写 NULL（未知），而不是 0。"""
    _create_provider(client)
    fake_httpx.script.append(FakeResponse(200, _ok_payload("{}")))
    resp = client.post(
        "/api/v1/llm/chat",
        json={"task_key": "parse_question", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.json()["data"]["usage"] == {
        "promptTokens": None,
        "completionTokens": None,
        "totalTokens": None,
    }
    log = client.get("/api/v1/llm/logs").json()["data"]["items"][0]
    assert log["promptTokens"] is None
    assert log["completionTokens"] is None
    assert log["totalTokens"] is None
    assert log["status"] == "ok"


# ---------------------------- AC-04 fallback 双日志 ----------------------------
def test_fallback_attempts_both_logged(client, fake_httpx):
    p1 = _create_provider(client, "primary")
    p2 = _create_provider(client, "backup")

    routes = client.put(
        "/api/v1/llm/routes",
        json={
            "items": [
                {
                    "taskKey": "text_to_sql",
                    "primaryProviderId": p1,
                    "primaryModel": "test-model",
                    "fallback": [{"providerId": p2, "model": "test-model"}],
                }
            ]
        },
        headers=CONFIRM,
    )
    assert routes.status_code == 200
    assert routes.json()["data"]["updated"] == 1

    # 第 1 次：上游超时；第 2 次：fallback 成功
    fake_httpx.script.append(httpx.ConnectTimeout("simulated timeout"))
    fake_httpx.script.append(
        FakeResponse(200, _ok_payload('{"sql":"SELECT 1"}', {"prompt_tokens": 5, "completion_tokens": 2}))
    )

    resp = client.post(
        "/api/v1/llm/chat",
        json={"task_key": "text_to_sql", "messages": [{"role": "user", "content": "q"}]},
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["providerId"] == p2
    assert data["attempts"] == 2

    logs = client.get("/api/v1/llm/logs").json()["data"]
    assert logs["total"] == 2, "两次尝试都必须落日志（AC-04）"
    by_status = {i["status"]: i for i in logs["items"]}
    assert by_status["error"]["errorCode"] == "upstream_timeout"
    assert by_status["error"]["providerId"] == p1
    assert by_status["ok"]["providerId"] == p2


def test_all_attempts_fail_returns_4020(client, fake_httpx):
    _create_provider(client)
    fake_httpx.script.append(FakeResponse(503, {"error": "boom"}, text="boom"))
    resp = client.post(
        "/api/v1/llm/chat",
        json={"task_key": "plan_analysis", "messages": [{"role": "user", "content": "x"}]},
    )
    assert resp.status_code == 502
    assert resp.json()["code"] == 4020
    log = client.get("/api/v1/llm/logs").json()["data"]["items"][0]
    assert log["status"] == "error"
    assert log["errorCode"] == "upstream_http"


# ---------------------------- 统计口径 ----------------------------
def test_stats_only_counts_ok_rows_with_usage(client, fake_httpx):
    _create_provider(client)
    # 1 条 ok 有 usage
    fake_httpx.script.append(
        FakeResponse(200, _ok_payload("{}", {"prompt_tokens": 10, "completion_tokens": 20}))
    )
    client.post(
        "/api/v1/llm/chat",
        json={"task_key": "plan_analysis", "messages": [{"role": "user", "content": "x"}]},
    )
    # 1 条 ok 无 usage（应被统计口径排除）
    fake_httpx.script.append(FakeResponse(200, _ok_payload("{}")))
    client.post(
        "/api/v1/llm/chat",
        json={"task_key": "plan_analysis", "messages": [{"role": "user", "content": "x"}]},
    )
    # 1 条 error 带 usage（也应被排除）
    fake_httpx.script.append(FakeResponse(500, {"usage": {"prompt_tokens": 99}}))
    client.post(
        "/api/v1/llm/chat",
        json={"task_key": "plan_analysis", "messages": [{"role": "user", "content": "x"}]},
    )

    stats = client.get("/api/v1/llm/stats", params={"groupBy": "task"}).json()["data"]
    assert len(stats["items"]) == 1
    item = stats["items"][0]
    assert item["key"] == "plan_analysis"
    assert item["calls"] == 1
    assert item["promptTokens"] == 10
    assert item["completionTokens"] == 20
    assert item["totalTokens"] == 30  # 记账求和（上游未给 total）
    assert stats["total"]["totalTokens"] == 30

    alias = client.get("/api/v1/llm/usage", params={"groupBy": "task"}).json()["data"]
    assert alias == stats


def test_stats_returns_null_when_no_usage_at_all(client, fake_httpx):
    _create_provider(client)
    fake_httpx.script.append(FakeResponse(200, _ok_payload("{}")))
    client.post(
        "/api/v1/llm/chat",
        json={"task_key": "plan_analysis", "messages": [{"role": "user", "content": "x"}]},
    )
    stats = client.get("/api/v1/llm/stats").json()["data"]
    assert stats["items"] == []
    assert stats["total"]["totalTokens"] is None
    assert stats["total"]["calls"] == 0


# ---------------------------- 路由 / 提供商管理 ----------------------------
def test_routes_seeded_and_logs_filterable(client):
    _create_provider(client)
    routes = client.get("/api/v1/llm/routes").json()["data"]["items"]
    keys = {r["taskKey"] for r in routes}
    assert {"plan_analysis", "narrate_insights", "parse_question", "text_to_sql"} <= keys

    filtered = client.get("/api/v1/llm/logs", params={"taskKey": "text_to_sql"})
    assert filtered.status_code == 200
    assert filtered.json()["data"]["items"] == []
    assert filtered.json()["data"]["total"] == 0


def test_provider_update_and_soft_delete(client):
    pid = _create_provider(client)
    upd = client.patch(
        f"/api/v1/llm/providers/{pid}",
        json={"model": "new-model", "isActive": False},
        headers=CONFIRM,
    )
    assert upd.status_code == 200
    view = client.get(f"/api/v1/llm/providers/{pid}").json()["data"]
    assert view["model"] == "new-model"
    assert view["isActive"] is False

    deleted = client.delete(f"/api/v1/llm/providers/{pid}", headers=CONFIRM)
    assert deleted.status_code == 200
    assert client.get(f"/api/v1/llm/providers/{pid}").status_code == 404
    assert client.get("/api/v1/llm/providers").json()["data"]["items"] == []


def test_settings_overview_aggregates(client):
    _create_provider(client)
    data = client.get("/api/v1/settings").json()["data"]
    assert data["privacy_mode"] == "strict"
    assert data["llm"]["providers_total"] == 1
    assert data["llm"]["providers_active"] == 1
    assert data["llm"]["configured"] is True
    assert isinstance(data["settings"], list)


def test_provider_test_probe_updates_embeddings_support(client, fake_httpx):
    pid = _create_provider(client)
    FakeClient.script = [
        FakeResponse(200, _ok_payload("{}")),
        FakeResponse(200, {"data": [{"embedding": [0.1, 0.2, 0.3]}]}),
    ]
    resp = client.post(f"/api/v1/llm/providers/{pid}/test", json={"probe": ["chat", "embeddings"]})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["chat"]["ok"] is True
    assert data["embeddings"]["ok"] is True
    assert data["embeddings"]["dim"] == 3
    assert client.get(f"/api/v1/llm/providers/{pid}").json()["data"]["embeddingsSupported"] is True
