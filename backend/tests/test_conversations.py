"""P2-4 会话与记忆契约测试（Spec AC-20/AC-21 后端侧 + openapi conversations/memories 契约）。"""

from __future__ import annotations

from tests.conftest import CONFIRM, provider_payload


def _create_conv(client, title="测试会话") -> dict:
    resp = client.post("/api/v1/conversations", json={"title": title})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["code"] == 0
    return body["data"]


def _append(client, conv_id, content, role="user", auto_respond=False) -> dict:
    resp = client.post(
        f"/api/v1/conversations/{conv_id}/messages",
        json={"role": role, "content": content, "autoRespond": auto_respond},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


# ---------------- conversations ----------------

def test_conversation_crud_and_archive(client):
    conv = _create_conv(client, "会话A")
    assert conv["title"] == "会话A"
    assert conv["messageCount"] == 0

    # 列表（未归档）
    items = client.get("/api/v1/conversations").json()["data"]["items"]
    assert any(c["id"] == conv["id"] for c in items)

    # 改名
    renamed = client.patch(f"/api/v1/conversations/{conv['id']}", json={"title": "改名B"})
    assert renamed.json()["data"]["title"] == "改名B"

    # 删除 = 归档：deleted 列表消失，archived=True 列表出现
    client.delete(f"/api/v1/conversations/{conv['id']}")
    items = client.get("/api/v1/conversations").json()["data"]["items"]
    assert all(c["id"] != conv["id"] for c in items)
    items_arch = client.get("/api/v1/conversations", params={"archived": "true"}).json()["data"]["items"]
    assert any(c["id"] == conv["id"] for c in items_arch)


def test_4040_when_conversation_missing(client):
    resp = client.get("/api/v1/conversations/no-such-id")
    assert resp.status_code == 404
    assert resp.json()["code"] == 4040


def test_messages_append_list_delete(client):
    conv = _create_conv(client)
    msg = _append(client, conv["id"], "你好")
    assert msg["userMessage"]["content"] == "你好"
    assert msg["assistantMessage"] is None  # autoRespond=false 不触发应答

    _append(client, conv["id"], "第二条")
    page = client.get(f"/api/v1/conversations/{conv['id']}/messages").json()["data"]
    assert page["total"] == 2
    # 倒序：最新在前
    assert page["items"][0]["content"] == "第二条"

    # 删除单条 + 条数回写
    mid = page["items"][0]["id"]
    client.delete(f"/api/v1/conversations/{conv['id']}/messages/{mid}")
    detail = client.get(f"/api/v1/conversations/{conv['id']}").json()["data"]
    assert detail["messageCount"] == 1


def test_autorespond_without_provider_returns_4010_and_persists_user_message(client):
    conv = _create_conv(client)
    resp = client.post(
        f"/api/v1/conversations/{conv['id']}/messages",
        json={"role": "user", "content": "帮我分析", "autoRespond": True},
    )
    # AC-03 同源：未配置 provider 必须是 4010，而不是静默伪造应答
    assert resp.status_code in (400, 401)
    assert resp.json()["code"] == 4010
    # 用户消息不丢（AC-20 语义：会话内容可靠）
    page = client.get(f"/api/v1/conversations/{conv['id']}/messages").json()["data"]
    assert page["total"] == 1
    assert page["items"][0]["content"] == "帮我分析"


def test_autorespond_with_provider_appends_assistant_message(client, monkeypatch):
    """有 provider 时网关被真实编排（mock 上游 httpx 转发），助手消息落库。"""
    import httpx

    created = client.post(
        "/api/v1/llm/providers",
        json=provider_payload(),
        headers=CONFIRM,
    ).json()["data"]

    class _FakeResp:
        status_code = 200
        text = ""
        def json(self):
            return {
                "choices": [{"message": {"content": "这是应答", "role": "assistant"}}],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            }

    real_post = httpx.AsyncClient.post

    async def _fake_post(self, url, *args, **kwargs):
        # 只拦截上游 LLM 转发；其余（无）放行
        if "chat/completions" not in str(url):
            return await real_post(self, url, *args, **kwargs)
        return _FakeResp()

    monkeypatch.setattr(httpx.AsyncClient, "post", _fake_post)

    conv = _create_conv(client)
    data = _append(client, conv["id"], "问题", auto_respond=True)
    assert data["assistantMessage"]["content"] == "这是应答"
    assert data["usage"]["totalTokens"] == 15
    assert data["assistantMessage"]["tokens"] == 15

    # 调用日志按 AC-05 落了一条 ok
    logs = client.get("/api/v1/llm/logs").json()["data"]["items"]
    assert any(l["providerId"] == created["id"] and l["status"] == "ok" for l in logs)


# ---------------- context 组装（AC-20/21 核心） ----------------

def test_context_injects_memories_and_respects_switch(client):
    conv = _create_conv(client)
    _append(client, conv["id"], "问题1")
    _append(client, conv["id"], "问题2")

    # 写入 global 记忆
    mem = client.post("/api/v1/memories", json={
        "scope": "global", "kind": "preference",
        "content": "用户偏好看按月趋势", "weight": 5,
    })
    assert mem.status_code == 201

    ctx = client.get(
        f"/api/v1/conversations/{conv['id']}/context", params={"budgetTokens": 4000}
    ).json()["data"]
    assert len(ctx["injectedMemories"]) == 1
    assert ctx["messages"][0]["role"] == "system"
    assert "按月趋势" in ctx["messages"][0]["content"]
    # 两条用户消息都在
    assert sum(1 for m in ctx["messages"] if m["role"] == "user") == 2

    # AC-21：关闭记忆开关后零注入
    from app.db import get_sessionmaker
    from app.repositories import memory_repo

    with get_sessionmaker()() as db:
        memory_repo.set_memory_enabled(db, False)
        db.commit()
    ctx2 = client.get(f"/api/v1/conversations/{conv['id']}/context").json()["data"]
    assert ctx2["injectedMemories"] == []
    assert all(m["role"] != "system" or "既知信息" not in m["content"] for m in ctx2["messages"])


def test_context_budget_trim_oldest_dropped(client):
    conv = _create_conv(client)
    for i in range(30):
        _append(client, conv["id"], f"消息{i}" + "x" * 200)
    ctx = client.get(
        f"/api/v1/conversations/{conv['id']}/context", params={"budgetTokens": 500}
    ).json()["data"]
    assert ctx["truncated"] is True
    # 预算内保新弃旧：最旧的消息不在上下文里
    contents = [m["content"] for m in ctx["messages"]]
    assert "消息0" not in "".join(contents)


# ---------------- memories CRUD ----------------

def test_memory_crud_and_filters(client):
    m1 = client.post("/api/v1/memories", json={
        "scope": "global", "kind": "fact", "content": "事实一", "weight": 1,
    }).json()["data"]
    m2 = client.post("/api/v1/memories", json={
        "scope": "conversation", "conversationId": "c-1", "kind": "insight",
        "content": "洞察二", "weight": 9,
    }).json()["data"]

    # scope 过滤 + weight 倒序
    page = client.get("/api/v1/memories", params={"scope": "conversation"}).json()["data"]
    assert page["total"] == 1 and page["items"][0]["content"] == "洞察二"

    # 修改
    upd = client.patch(f"/api/v1/memories/{m1['id']}", json={"weight": 3.5})
    assert upd.json()["data"]["weight"] == 3.5

    # 删除后不可见
    client.delete(f"/api/v1/memories/{m2['id']}")
    page = client.get("/api/v1/memories").json()["data"]
    assert all(x["id"] != m2["id"] for x in page["items"])


def test_memory_validation_rejects_bad_scope(client):
    resp = client.post("/api/v1/memories", json={
        "scope": "bogus", "kind": "fact", "content": "x",
    })
    assert resp.status_code == 422


def test_summarize_without_provider_returns_4010(client):
    conv = _create_conv(client)
    for i in range(12):
        _append(client, conv["id"], f"第{i}轮对话内容")
    resp = client.post(f"/api/v1/conversations/{conv['id']}/summarize", json={"keepRecent": 5})
    assert resp.status_code in (400, 401)
    assert resp.json()["code"] == 4010
