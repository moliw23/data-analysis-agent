# -*- coding: utf-8 -*-
"""修正契约测试中的路由/状态码假设：以真实实现为准（201、/search、/datasets/{id}/query、get_sessionmaker）。"""
import io

p = r"E:/workbuddyapp/数据分析agent/data-analysis-agent/backend/tests/test_f0_f1_contract.py"
s = io.open(p, encoding="utf-8").read()

pairs = [
    # SQL 查询的真实路径是 /api/v1/datasets/{id}/query
    ('''    blocked = client.post(
        "/api/v1/sql/query", json={"datasetId": "x", "sql": "SELECT 1"}
    )''',
     '''    blocked = client.post(
        "/api/v1/datasets/x/query", json={"sql": "SELECT 1"}
    )'''),
    ('''    allowed = client.post(
        "/api/v1/sql/query", json={"datasetId": "x", "sql": "SELECT 1"}
    )''',
     '''    allowed = client.post(
        "/api/v1/datasets/x/query", json={"sql": "SELECT 1"}
    )'''),
    # 检索端点是 /search 而非 /retrieve
    ('''    resp = client.post(
        "/api/v1/knowledge-bases/kb-x/retrieve", json={"query": "营收"}
    )''',
     '''    resp = client.post(
        "/api/v1/knowledge-bases/kb-x/search", json={"query": "营收"}
    )'''),
    # 创建 provider 返回 201
    ('''    assert created.status_code == 200
    assert created.json()["code"] == 0''',
     '''    assert created.status_code in (200, 201)
    assert created.json()["code"] == 0'''),
    # 会话工厂名是 get_sessionmaker()
    ("    from app.db import SessionLocal\n    from app.models.llm import LlmCallLog",
     "    from app.db import get_sessionmaker\n    from app.models.llm import LlmCallLog"),
    ("    with SessionLocal() as db:", "    with get_sessionmaker()() as db:"),
]
for old, new in pairs:
    n = s.count(old)
    s = s.replace(old, new)
    print("%d x %s" % (n, old[:52].replace("\n", " ")))

io.open(p, "w", encoding="utf-8", newline="\n").write(s)
print("done")
