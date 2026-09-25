"""F0 闸门矩阵 + capabilities 同源性 + 请求体级闸门 + 签名层拒绝明细行。

矩阵不抄文档：直接 import CAPABILITY_GATES，遍历断言（零副本，改常量测试立刻跟上）。
"""

from __future__ import annotations

import pytest

from app.core.privacy import CAPABILITY_GATES
from tests.conftest import CONFIRM

MODES = ["strict", "standard", "full"]

# capability -> 受闸门管控的端点（路由级）
GATED_ENDPOINTS: dict[str, list[tuple[str, str, dict]]] = {
    "kb_ingest": [
        ("POST", "/api/v1/knowledge-bases", {}),
        ("POST", "/api/v1/knowledge-bases/kb1/documents", {}),
        ("POST", "/api/v1/knowledge-bases/kb1/documents/d1/reprocess", {}),
        ("POST", "/api/v1/knowledge-bases/kb1/reindex", {}),
    ],
    "kb_search": [
        ("POST", "/api/v1/knowledge-bases/kb1/search", {}),
    ],
    "server_sql": [
        ("POST", "/api/v1/datasets/ds1/upload", {}),
        ("POST", "/api/v1/datasets/ds1/query", {"sql": "SELECT 1"}),
    ],
}


def _set_mode(client, mode: str) -> None:
    resp = client.put(
        "/api/v1/settings/privacy-mode",
        json={"privacy_mode": mode},
        headers=CONFIRM,
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["privacy_mode"] == mode


@pytest.mark.parametrize("mode", MODES)
@pytest.mark.parametrize("capability", sorted(GATED_ENDPOINTS))
def test_route_level_gate_matrix(client, capability, mode):
    """三档 x 受控端点逐格断言：允许档位放行（非 4030），其余返回 4030。"""
    _set_mode(client, mode)
    allowed = mode in CAPABILITY_GATES[capability]
    for method, path, payload in GATED_ENDPOINTS[capability]:
        resp = client.request(method, path, json=payload)
        body = resp.json()
        if allowed:
            assert body["code"] != 4030, f"{path} 不应被阻断（mode={mode}）"
        else:
            assert resp.status_code == 403, f"{path} 应返回 HTTP 403（mode={mode}）"
            assert body["code"] == 4030, f"{path} 应返回 4030（mode={mode}）"
            data = body["data"]
            assert data["current_mode"] == mode
            assert data["capability"] == capability
            assert data["required_modes"] == list(CAPABILITY_GATES[capability])
            assert data["setting_path"] == "/api/v1/settings/privacy-mode"
            assert set(data["blocked_by_downgrade"]) == {
                "server_datasets",
                "knowledge_bases",
                "kb_documents",
            }
            # 4030 必须带可执行指引，而不是裸拒绝
            assert "档位" in body["message"] and "切换" in body["message"]


@pytest.mark.parametrize("mode", MODES)
def test_capabilities_are_same_source_as_gates(client, mode):
    """③ 类消费点同源断言：capabilities 声明 == 接口实际可调用性。"""
    _set_mode(client, mode)
    caps = client.get("/api/v1/capabilities").json()["data"]
    assert caps["privacy_mode"] == mode
    expect_kb_ingest = mode in CAPABILITY_GATES["kb_ingest"]
    expect_kb_search = mode in CAPABILITY_GATES["kb_search"]
    expect_server_sql = mode in CAPABILITY_GATES["server_sql"]
    assert caps["knowledge"]["ingest_allowed"] == expect_kb_ingest
    assert caps["knowledge"]["search_allowed"] == expect_kb_search
    assert caps["dataset"]["server_sql_allowed"] == expect_server_sql
    assert caps["dataset"]["server_storage_allowed"] == (
        mode in CAPABILITY_GATES["server_dataset_register"]
    )
    assert caps["server_sql"] == expect_server_sql
    assert caps["external_db_proxy"] is True


def test_rag_enabled_requires_both_vector_and_gate(client, monkeypatch):
    """rag.enabled = 向量库可用 AND 档位允许知识库（两者缺一不可）。"""
    from app.services import privacy_service

    _set_mode(client, "strict")
    monkeypatch.setattr(privacy_service, "vector_available", lambda: True)
    strict_caps = client.get("/api/v1/capabilities").json()["data"]
    assert strict_caps["rag"]["vector_available"] is True
    assert strict_caps["rag"]["enabled"] is False  # 档位仍闸着

    _set_mode(client, "standard")
    std_caps = client.get("/api/v1/capabilities").json()["data"]
    assert std_caps["rag"]["enabled"] is True

    monkeypatch.setattr(privacy_service, "vector_available", lambda: False)
    off_caps = client.get("/api/v1/capabilities").json()["data"]
    assert off_caps["rag"]["enabled"] is False  # 只在档位放开也不够


def test_body_level_gate_server_storage(client):
    """② 请求体级闸门：同一端点按 storageMode 取值判定。"""
    body_server = {"name": "ds", "storageMode": "server", "rowCount": 10}
    body_local = {"name": "ds", "storageMode": "local", "rowCount": 10}

    _set_mode(client, "strict")
    assert client.post("/api/v1/datasets", json=body_server).json()["code"] == 4030
    assert client.post("/api/v1/datasets", json=body_local).json()["code"] == 4090

    _set_mode(client, "standard")
    assert client.post("/api/v1/datasets", json=body_server).json()["code"] == 4030
    assert client.post("/api/v1/datasets", json=body_local).json()["code"] == 4090

    _set_mode(client, "full")
    assert client.post("/api/v1/datasets", json=body_server).json()["code"] == 4090
    assert client.post("/api/v1/datasets", json=body_local).json()["code"] == 4090


def test_register_endpoint_rejects_detail_rows_at_signature(client):
    """strict 下接口签名层就收不了明细行：rows 字段被 extra='forbid' 直接拒绝。"""
    _set_mode(client, "strict")
    resp = client.post(
        "/api/v1/datasets",
        json={"name": "ds", "storageMode": "local", "rows": [[1, 2], [3, 4]]},
    )
    assert resp.status_code == 422
    assert resp.json()["code"] == 4000


def test_downgrade_does_not_delete_and_reports_counts(client):
    """降级不删除数据：blocked_by_downgrade 字段恒存在且为计数。"""
    _set_mode(client, "full")
    payload = client.get("/api/v1/settings/privacy-mode").json()["data"]
    assert payload["blocked_by_downgrade"] == {
        "server_datasets": 0,
        "knowledge_bases": 0,
        "kb_documents": 0,
    }
    _set_mode(client, "strict")
    strict_payload = client.get("/api/v1/settings/privacy-mode").json()["data"]
    grants = strict_payload["effective_grants"]
    assert grants["kb_ingest"] is False
    assert grants["kb_search"] is False
    assert grants["server_sql"] is False
    assert grants["llm_proxy"] is True
    assert grants["external_db_proxy"] is True


def test_privacy_mode_change_updates_capabilities_immediately(client):
    """AC-02：改档后 capabilities 派生结果同步变化。"""
    before = client.get("/api/v1/capabilities").json()["data"]
    _set_mode(client, "standard")
    after = client.get("/api/v1/capabilities").json()["data"]
    assert before["knowledge"]["ingest_allowed"] is False
    assert after["knowledge"]["ingest_allowed"] is True
