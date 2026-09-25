"""F0 隐私档位 + F1 LLM 网关 的契约测试（Spec AC-01 ~ AC-06）。

覆盖：
- 统一信封在业务错误（4010 / 4030 / 4040）下的形态
- 4030 真闸门：strict 档下知识库入库与服务端 SQL 被阻断，且载荷带可执行指引
- capabilities 随档位切换而变化（三档各断言一次）
- 4010：未配置任何 provider 时 chat 被拒，message 指明配置入口
- 密钥安全：明文 key 绝不出现在任何响应里（只出现掩码）
- Token 语义：上游未返回 usage 时字段为 NULL 而非 0
"""

from __future__ import annotations

import pytest

from tests.conftest import CONFIRM, provider_payload

PLAINTEXT_KEY = "sk-testPLAINTEXTKEY123456"


# ---------------- F0：4030 真闸门 ----------------

def test_4030_blocks_kb_ingest_in_strict(client):
    resp = client.post(
        "/api/v1/knowledge-bases", json={"name": "kb1", "description": ""}
    )
    assert resp.status_code == 403
    body = resp.json()
    assert body["code"] == 4030
    assert "detail" not in body
    data = body["data"]
    assert data["current_mode"] == "strict"
    # 可执行指引：告诉用户切到哪一档、去哪里改
    assert data["required_modes"] == ["standard", "full"]
    assert data["setting_path"] == "/api/v1/settings/privacy-mode"
    assert data["capability"] == "kb_ingest"
    # 被阻断计数恒存在（降级不删数据）
    assert set(data["blocked_by_downgrade"]) == {
        "server_datasets", "knowledge_bases", "kb_documents"
    }
    # 文案必须含档位名与去向，不能只是"不允许"
    assert "strict" in body["message"]
    assert "standard" in body["message"]


def test_4030_blocks_server_sql_in_strict_and_full_allows(client):
    blocked = client.post(
        "/api/v1/datasets/x/query", json={"sql": "SELECT 1"}
    )
    assert blocked.status_code == 403
    assert blocked.json()["code"] == 4030

    # 切到 full 后，同一入口不再返回 4030（业务未实现则返回 4090，不是 4030）
    switch = client.put(
        "/api/v1/settings/privacy-mode",
        json={"privacy_mode": "full"},
        headers=CONFIRM,
    )
    assert switch.status_code == 200
    allowed = client.post(
        "/api/v1/datasets/x/query", json={"sql": "SELECT 1"}
    )
    assert allowed.status_code != 403
    assert allowed.json()["code"] != 4030


def test_4030_blocks_kb_search_in_strict(client):
    resp = client.post(
        "/api/v1/knowledge-bases/kb-x/search", json={"query": "营收"}
    )
    assert resp.status_code == 403
    body = resp.json()
    assert body["code"] == 4030
    assert body["data"]["capability"] == "kb_search"


def test_strict_blocks_document_upload_but_standard_allows(client):
    blocked = client.post(
        "/api/v1/knowledge-bases/kb-x/documents",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    assert blocked.status_code == 403
    assert blocked.json()["code"] == 4030

    client.put(
        "/api/v1/settings/privacy-mode",
        json={"privacy_mode": "standard"},
        headers=CONFIRM,
    )
    allowed = client.post(
        "/api/v1/knowledge-bases/kb-x/documents",
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    # RAG 业务本波未实现（4090），但绝不能是隐私闸门 4030
    assert allowed.json()["code"] != 4030


# ---------------- capabilities 随档位派生（与闸门同源） ----------------

@pytest.mark.parametrize(
    "mode,rag_ingest,server_sql",
    [("strict", False, False), ("standard", True, False), ("full", True, True)],
)
def test_capabilities_derive_per_mode(client, mode, rag_ingest, server_sql):
    put = client.put(
        "/api/v1/settings/privacy-mode",
        json={"privacy_mode": mode},
        headers=CONFIRM,
    )
    assert put.status_code == 200
    data = client.get("/api/v1/capabilities").json()["data"]
    assert data["privacy_mode"] == mode
    assert data["rag"]["ingest_allowed"] is rag_ingest
    assert data["knowledge"]["ingest_allowed"] is rag_ingest
    assert data["dataset"]["server_sql_allowed"] is server_sql
    # 扁平别名与嵌套视图必须一致（同一真相，不得各算各的）
    assert data["rag_enabled"] == data["rag"]["enabled"]
    assert data["server_sql"] == data["dataset"]["server_sql_allowed"]


def test_capability_gate_and_capabilities_single_source():
    """闸门表是唯一真相源：capabilities 派生必须由 CAPABILITY_GATES 推出。"""
    from app.core.privacy import CAPABILITY_GATES, PrivacyPolicy

    for mode in ("strict", "standard", "full"):
        policy = PrivacyPolicy(mode)
        caps = policy.derive_capabilities()
        assert caps["rag"]["ingest_allowed"] == policy.allows("kb_ingest")
        assert caps["knowledge"]["search_allowed"] == policy.allows("kb_search")
        assert caps["dataset"]["server_sql_allowed"] == policy.allows("server_sql")
        # 未登记的 capability 必须 fail-closed
        assert policy.allows("not_a_capability") is False
    assert set(CAPABILITY_GATES) >= {"kb_ingest", "kb_search", "server_sql"}


# ---------------- F1：4010 与密钥安全 ----------------

def test_4010_when_no_provider_configured(client):
    resp = client.post(
        "/api/v1/llm/chat",
        json={"taskKey": "text_to_sql",
              "messages": [{"role": "user", "content": "hi"}]},
    )
    assert resp.status_code in (401, 400)
    body = resp.json()
    assert body["code"] == 4010
    assert "detail" not in body
    # message 必须指明配置入口，不能只说"失败"
    assert "provider" in body["message"].lower() or "供应商" in body["message"]


def test_provider_plaintext_key_never_in_responses(client):
    created = client.post(
        "/api/v1/llm/providers", json=provider_payload(key=PLAINTEXT_KEY),
        headers=CONFIRM,
    )
    assert created.status_code in (200, 201)
    assert created.json()["code"] == 0

    for path in ("/api/v1/llm/providers", "/api/v1/llm/logs", "/api/v1/llm/stats"):
        raw = client.get(path).text
        assert PLAINTEXT_KEY not in raw, f"明文 key 泄漏在 {path}"

    listed = client.get("/api/v1/llm/providers").json()["data"]["items"]
    assert listed, "provider 应已创建"
    hint = listed[0]["apiKeyHint"]
    assert hint and hint != PLAINTEXT_KEY
    assert hint.startswith("sk-") and "***" in hint


def test_provider_update_does_not_echo_key(client):
    created = client.post(
        "/api/v1/llm/providers", json=provider_payload(), headers=CONFIRM
    ).json()["data"]
    pid = created["id"]
    updated = client.put(
        f"/api/v1/llm/providers/{pid}",
        json={"model": "m2"},
        headers=CONFIRM,
    )
    assert updated.status_code == 200
    assert PLAINTEXT_KEY not in updated.text


# ---------------- Token 统计口径：NULL ≠ 0 ----------------

def test_extract_usage_missing_usage_is_none_not_zero():
    from app.services.llm_service import _extract_usage

    assert _extract_usage({}) == {
        "prompt_tokens": None, "completion_tokens": None, "total_tokens": None
    }
    assert _extract_usage({"usage": None})["total_tokens"] is None
    # 上游只回部分字段时，缺失的仍是 None（未知），已有的保留
    partial = _extract_usage({"usage": {"prompt_tokens": 12}})
    assert partial["prompt_tokens"] == 12
    assert partial["completion_tokens"] is None
    full = _extract_usage({"usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}})
    assert full == {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}


def test_usage_stats_skip_rows_without_usage(client):
    """统计只计 status=ok 且有 usage 的行；无 usage 的行不得被当 0 计入。"""
    from sqlalchemy import select

    from app.db import get_sessionmaker
    from app.models.llm import LlmCallLog
    from app.repositories import llm_repo

    created = client.post(
        "/api/v1/llm/providers", json=provider_payload(), headers=CONFIRM
    ).json()["data"]
    pid = created["id"]

    with get_sessionmaker()() as db:
        llm_repo.create_log(db, {
            "provider_id": pid, "model": "m", "task_key": "text_to_sql",
            "status": "ok", "error_code": None, "error_message": None,
            "latency_ms": 5,
            "prompt_tokens": None, "completion_tokens": None, "total_tokens": None,
        })
        llm_repo.create_log(db, {
            "provider_id": pid, "model": "m", "task_key": "text_to_sql",
            "status": "ok", "error_code": None, "error_message": None,
            "latency_ms": 5,
            "prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15,
        })
        rows = list(db.execute(select(LlmCallLog)).scalars())
        assert len(rows) == 2
        none_row = [r for r in rows if r.total_tokens is None]
        assert len(none_row) == 1, "无 usage 的行必须存 NULL，而不是 0"
        # 仓储层不负责提交（分层规范：提交由 service 编排），测试里显式提交
        db.commit()

    # 口径函数直接验证（Spec §6.1：仅统计 status=ok 且至少一个 token 字段非 NULL）
    from app.repositories.llm_repo import aggregate_usage

    with get_sessionmaker()() as db:
        agg = aggregate_usage(db, group_by="day")
    assert len(agg) == 1, f"无 usage 的行不得单独成组（实际 {len(agg)} 组）"
    assert agg[0]["calls"] == 1, (
        "无 usage 的行不计入 Token 统计（Spec §6.1：仅统计 status=ok 且有 usage 的记录）"
    )
    assert agg[0]["totalTokens"] == 15, (
        f"SUM 忽略 NULL（期望 15，实际 {agg[0]['totalTokens']}）"
    )
    assert agg[0]["promptTokens"] == 10 and agg[0]["completionTokens"] == 5
