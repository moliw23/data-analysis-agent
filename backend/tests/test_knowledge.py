"""P2-5 RAG 契约测试：入库/切分/FTS5 检索/4091/降级语义/出本机凭据(AC-28)。
隐私档位闸门矩阵已在 test_privacy_gate.py / test_f0_f1_contract.py 覆盖。
"""

from __future__ import annotations

from tests.conftest import CONFIRM


def _make_kb(client, name="kb-main") -> dict:
    # RAG 功能在 standard 档即可用（kb_ingest 允许档位），先切档再操作
    switch = client.put(
        "/api/v1/settings/privacy-mode", json={"privacy_mode": "standard"},
        headers=CONFIRM,
    )
    assert switch.status_code == 200
    resp = client.post("/api/v1/knowledge-bases", json={"name": name, "description": ""})
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


def _upload(client, kb_id: str, filename: str, content: bytes) -> dict:
    resp = client.post(
        f"/api/v1/knowledge-bases/{kb_id}/documents",
        files={"file": (filename, content, "text/plain")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["data"]


SAMPLE = (
    "2026 年第三季度营收为 1.2 亿元，环比增长 15%。\n"
    "华东区贡献了 45% 的营收，是第一大市场。\n"
    "华南区增速最快，达到 28%。\n"
    "毛利率稳定在 62% 左右。\n"
) * 3


def test_kb_crud_and_name_conflict(client):
    kb = _make_kb(client, "crud-kb")
    detail = client.get(f"/api/v1/knowledge-bases/{kb['id']}").json()["data"]
    assert detail["indexStatus"] == "empty" and detail["docCount"] == 0

    resp = client.post("/api/v1/knowledge-bases", json={"name": "crud-kb"})
    assert resp.json()["code"] == 4090  # 同名冲突 = 状态冲突

    client.patch(f"/api/v1/knowledge-bases/{kb['id']}", json={"name": "crud-kb2"})
    client.delete(f"/api/v1/knowledge-bases/{kb['id']}")
    items = client.get("/api/v1/knowledge-bases").json()["data"]["items"]
    assert all(x["id"] != kb["id"] for x in items)


def test_upload_ingest_and_search_keyword(client):
    kb = _make_kb(client, "search-kb")

    # 空库检索 → 4091（索引未就绪口径，Spec §6.1）
    empty_search = client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search", json={"query": "营收"}
    )
    assert empty_search.json()["code"] == 4091

    doc = _upload(client, kb["id"], "q3.md", SAMPLE.encode("utf-8"))
    assert doc["status"] == "ready"
    assert doc["chunkCount"] > 0
    assert doc["ingestedMode"] == "standard"  # AC-28：入库档位凭据（测试已切 standard）

    # 检索命中关键词
    result = client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search",
        json={"query": "毛利率", "mode": "keyword", "topK": 3},
    ).json()["data"]
    assert result["hits"], "关键词应命中分块"
    assert "毛利率" in result["hits"][0]["content"]
    assert result["mode"] == "keyword"  # 无 chroma/无 embedding provider → 诚实降级
    assert result["latencyMs"] >= 0

    # 检索记录 + 反馈
    fb = client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/queries/{result['queryId']}/feedback",
        json={"feedback": 1},
    )
    assert fb.json()["data"]["feedback"] == 1

    # 分块预览
    chunks = client.get(
        f"/api/v1/knowledge-bases/{kb['id']}/documents/{doc['id']}/chunks"
    ).json()["data"]
    assert chunks["total"] == doc["chunkCount"]

    # stats 含入库档位分布（AC-28 筛选依据）
    stats = client.get(f"/api/v1/knowledge-bases/{kb['id']}/stats").json()["data"]
    assert stats["docsByIngestedMode"].get("standard", 0) >= 1


def test_upload_duplicate_sha_rejected(client):
    kb = _make_kb(client, "dup-kb")
    _upload(client, kb["id"], "a.txt", b"hello world")
    resp = client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/documents",
        files={"file": ("a.txt", b"hello world", "text/plain")},
    )
    assert resp.json()["code"] == 4090  # 同内容重复入库 = 状态冲突


def test_doc_delete_updates_index_and_search(client):
    kb = _make_kb(client, "del-kb")
    doc = _upload(client, kb["id"], "x.txt", SAMPLE.encode("utf-8"))
    resp = client.delete(f"/api/v1/knowledge-bases/{kb['id']}/documents/{doc['id']}")
    assert resp.json()["code"] == 0
    # 文档删空后回到 empty，检索回到 4091
    search = client.post(
        f"/api/v1/knowledge-bases/{kb['id']}/search", json={"query": "营收"}
    )
    assert search.json()["code"] == 4091


def test_reindex_reports_status(client):
    kb = _make_kb(client, "reindex-kb")
    _upload(client, kb["id"], "y.txt", SAMPLE.encode("utf-8"))
    result = client.post(f"/api/v1/knowledge-bases/{kb['id']}/reindex").json()["data"]
    assert result["reindexed"] is True
    assert result["indexStatus"] == "ready"


def test_4040_when_kb_missing(client):
    resp = client.get("/api/v1/knowledge-bases/no-such")
    assert resp.status_code == 404
    assert resp.json()["code"] == 4040


def test_split_chunks_semantics():
    from app.services.knowledge_service import split_chunks

    long_text = "\n".join(f"第{i}行：这里是测试内容" for i in range(200))
    chunks = split_chunks(long_text, size=300, overlap=30)
    assert len(chunks) > 1
    assert all(len(c) <= 300 for c in chunks), "切分不得超过窗口上限"
    assert "".join(chunks[0].split("\n"))[:10] in long_text.replace("\n", "")
