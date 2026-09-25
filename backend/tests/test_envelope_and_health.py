"""统一信封 + health/capabilities + 业务错误码映射。"""

from __future__ import annotations

import pytest

from tests.conftest import CONFIRM


def test_health_returns_envelope_with_code_zero(client):
    body = client.get("/api/v1/health").json()
    assert body["code"] == 0
    assert body["message"] == "ok"
    assert set(body) == {"code", "data", "message", "request_id"}
    assert body["request_id"]
    data = body["data"]
    assert data["status"] in ("ok", "degraded")
    assert data["version"]
    assert data["subsystems"]["db"] is True


def test_capabilities_default_strict_not_rag(client):
    body = client.get("/api/v1/capabilities").json()
    assert body["code"] == 0
    data = body["data"]
    assert data["privacy_mode"] == "strict"
    assert data["rag"]["enabled"] is False
    assert data["rag"]["ingest_allowed"] is False
    assert data["dataset"]["server_storage_allowed"] is False
    assert data["dataset"]["local_storage_allowed"] is True
    assert data["server_sql"] is False
    assert data["external_db_proxy"] is True


def test_capabilities_meta_alias_same_payload(client):
    direct = client.get("/api/v1/capabilities").json()["data"]
    alias = client.get("/api/v1/meta/capabilities").json()["data"]
    assert direct == alias


def test_422_validation_error_uses_envelope(client):
    resp = client.post("/api/v1/llm/chat", json={"messages": []})
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == 4000
    assert "detail" not in body
    assert isinstance(body["data"]["errors"], list) and body["data"]["errors"]


def test_404_uses_envelope_not_detail(client):
    resp = client.get("/api/v1/llm/providers/does-not-exist")
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == 4040
    assert "detail" not in body
    assert body["request_id"]


def test_unknown_api_path_uses_envelope(client):
    resp = client.get("/api/v1/no-such-endpoint")
    assert resp.status_code == 404
    assert resp.json()["code"] == 4040


def test_confirm_header_missing_returns_4011(client):
    resp = client.put(
        "/api/v1/settings/privacy-mode", json={"privacy_mode": "standard"}
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == 4011


def test_invalid_privacy_mode_rejected(client):
    resp = client.put(
        "/api/v1/settings/privacy-mode",
        json={"privacy_mode": "unlimited"},
        headers=CONFIRM,
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == 4000


@pytest.mark.parametrize("mode", ["strict", "standard", "full"])
def test_privacy_mode_put_get_roundtrip(client, mode):
    put = client.put(
        "/api/v1/settings/privacy-mode",
        json={"privacy_mode": mode},
        headers=CONFIRM,
    )
    assert put.status_code == 200
    assert put.json()["data"]["privacy_mode"] == mode
    got = client.get("/api/v1/settings/privacy-mode").json()
    assert got["data"]["privacy_mode"] == mode
    assert set(got["data"]["blocked_by_downgrade"]) == {
        "server_datasets",
        "knowledge_bases",
        "kb_documents",
    }
