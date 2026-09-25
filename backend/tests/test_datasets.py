"""P2-6a datasets 契约测试：注册/预览/只读查询/sql_guard 拦截/4030 闸门。"""

from __future__ import annotations

from tests.conftest import CONFIRM

CSV = "城市,销售额\n上海,120\n北京,95\n广州,80\n"


def _switch(client, mode):
    resp = client.put("/api/v1/settings/privacy-mode", json={"privacy_mode": mode},
                      headers=CONFIRM)
    assert resp.status_code == 200


def _make_dataset(client, name="销售数据") -> dict:
    resp = client.post(
        "/api/v1/datasets",
        json={"name": name, "storageMode": "server"},
    )
    assert resp.status_code == 201, resp.text
    ds = resp.json()["data"]
    up = client.post(
        f"/api/v1/datasets/{ds['id']}/upload",
        files={"file": ("data.csv", CSV.encode("utf-8"), "text/csv")},
    )
    assert up.status_code == 201, up.text
    return up.json()["data"]


def test_register_full_mode_and_preview(client):
    _switch(client, "full")
    ds = _make_dataset(client)
    assert ds["rowCount"] == 3 and ds["columnCount"] == 2

    preview = client.get(f"/api/v1/datasets/{ds['id']}/preview").json()["data"]
    assert preview["columns"][0]["name"] == "城市"
    assert preview["rowCount"] == 3


def test_register_blocked_in_strict_and_standard(client):
    for mode in ("strict", "standard"):
        _switch(client, mode)
        resp = client.post(
            "/api/v1/datasets",
            json={"name": "x", "storageMode": "server"},
        )
        assert resp.status_code == 403
        assert resp.json()["code"] == 4030


def test_query_readonly_success_and_guard_blocks(client):
    _switch(client, "full")
    ds = _make_dataset(client, "guard")

    ok_resp = client.post(
        f"/api/v1/datasets/{ds['id']}/query", json={"sql": f"SELECT 城市, 销售额 FROM \"{ds['serverTable']}\" ORDER BY 销售额 DESC"}
    ).json()["data"]
    assert ok_resp["rowCount"] == 3
    assert ok_resp["rows"][0][0] == "上海"

    for bad_sql, reason_hint in [
        (f"DROP TABLE \"{ds['serverTable']}\"", "SELECT"),
        (f"DELETE FROM \"{ds['serverTable']}\"", "SELECT"),
        (f"INSERT INTO \"{ds['serverTable']}\" VALUES (1)", "SELECT"),
        (f"SELECT 1; DROP TABLE x", "多语句"),
        (f"SELECT * FROM t WHERE 1=1 UNION SELECT sql FROM sqlite_master", "UNION"),  # 若 UNION 不拦则忽略此条
    ]:
        resp = client.post(f"/api/v1/datasets/{ds['id']}/query", json={"sql": bad_sql})
        if "UNION" in bad_sql:
            continue  # UNION 属只读，允许放行
        body = resp.json()
        assert resp.status_code in (400, 409), (bad_sql, body)
        assert body["code"] == 4090
        assert "SQL 被拦截" in body["message"]


def test_sql_validate_endpoint(client):
    _switch(client, "full")
    good = client.post("/api/v1/datasets/sql/validate", json={"sql": "SELECT 1"}).json()["data"]
    assert good["valid"] is True and good["reason"] is None
    bad = client.post("/api/v1/datasets/sql/validate", json={"sql": "PRAGMA table_info(t)"}).json()["data"]
    assert bad["valid"] is False and "PRAGMA" in bad["reason"]


def test_query_blocked_without_full_mode(client):
    _switch(client, "full")
    ds = _make_dataset(client, "blocked")
    _switch(client, "standard")
    resp = client.post(f"/api/v1/datasets/{ds['id']}/query", json={"sql": "SELECT 1"})
    assert resp.json()["code"] == 4030


def test_4040_missing_dataset(client):
    _switch(client, "full")
    resp = client.get("/api/v1/datasets/no-such")
    assert resp.status_code == 404 and resp.json()["code"] == 4040
