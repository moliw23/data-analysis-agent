"""P2-6b 调度与通知契约测试（AC-22 审计口径 / AC-23 三连败自动暂停）。"""

from __future__ import annotations

from tests.conftest import CONFIRM


def _make_dataset(client) -> dict:
    client.put("/api/v1/settings/privacy-mode", json={"privacy_mode": "full"},
               headers=CONFIRM)
    resp = client.post("/api/v1/datasets", json={"name": "定时数据", "storageMode": "server"})
    assert resp.status_code == 201, resp.text
    ds = resp.json()["data"]
    up = client.post(
        f"/api/v1/datasets/{ds['id']}/upload",
        files={"file": ("d.csv", b"city,val\nSH,1\nBJ,2\n", "text/csv")},
    )
    assert up.status_code == 201, up.text
    return up.json()["data"]


def _make_job(client, ds_id: str, sql: str, name="每日汇总") -> dict:
    resp = client.post("/api/v1/schedules", json={
        "name": name, "jobType": "dataset_query", "datasetId": ds_id,
        "cron": "0 7 * * *", "params": {"sql": sql},
    })
    assert resp.status_code == 201, resp.text
    body = resp.json()["data"]
    assert body["nextRunAt"] is not None  # cron 解析成功才有下次触发时间
    return body


def test_create_job_cron_validation_and_list(client):
    ds = _make_dataset(client)
    job = _make_job(client, ds["id"], f'SELECT COUNT(*) AS n FROM "{ds["serverTable"]}"')

    items = client.get("/api/v1/schedules").json()["data"]["items"]
    assert any(x["id"] == job["id"] for x in items)

    bad = client.post("/api/v1/schedules", json={
        "name": "坏任务", "jobType": "dataset_query", "datasetId": ds["id"],
        "cron": "not-a-cron",
    })
    assert bad.json()["code"] == 4090
    assert "cron" in bad.json()["message"]


def test_manual_run_success_and_history(client):
    ds = _make_dataset(client)
    job = _make_job(client, ds["id"], f'SELECT city, val FROM "{ds["serverTable"]}" ORDER BY val DESC')

    result = client.post(f"/api/v1/schedules/{job['id']}/run").json()["data"]
    assert result["run"]["status"] == "ok"
    assert result["run"]["result"]["rowCount"] == 2
    assert result["job"]["lastStatus"] == "ok"
    assert result["job"]["consecutiveFailures"] == 0

    runs = client.get(f"/api/v1/schedules/{job['id']}/runs").json()["data"]
    assert runs["total"] == 1 and runs["items"][0]["status"] == "ok"
    assert runs["items"][0]["durationMs"] is not None  # AC-22：历史含耗时


def test_run_failure_records_error(client):
    ds = _make_dataset(client)
    job = _make_job(client, ds["id"], "SELECT no_such_col FROM sqlite_master", name="会失败")

    result = client.post(f"/api/v1/schedules/{job['id']}/run").json()["data"]
    assert result["run"]["status"] == "failed"
    assert result["run"]["error"]
    assert result["job"]["consecutiveFailures"] == 1
    # 任务未被暂停（未达 3 次）
    assert result["job"]["enabled"] is True


def test_three_consecutive_failures_auto_pause_and_notify(client):
    """AC-23：连续 3 次失败 → enabled=false + 生成通知。"""
    ds = _make_dataset(client)
    job = _make_job(client, ds["id"], "SELECT nope FROM sqlite_master", name="三连败")

    for i in range(3):
        result = client.post(f"/api/v1/schedules/{job['id']}/run").json()["data"]
        if i < 2:
            assert result["job"]["enabled"] is True
    assert result["job"]["enabled"] is False
    assert result["job"]["lastStatus"] == "paused"
    assert result["job"]["nextRunAt"] is None

    notifs = client.get("/api/v1/notifications", params={"unreadOnly": "true"}).json()["data"]
    assert any("已自动暂停" in n["title"] for n in notifs["items"])

    # 通知可标记已读
    nid = notifs["items"][0]["id"]
    marked = client.patch(f"/api/v1/notifications/{nid}", json={"read": True}).json()["data"]
    assert marked["read"] is True


def test_privacy_gate_blocks_dataset_query_job_in_strict(client):
    """调度任务执行前的 service 层二次校验（P2-6 排期硬要求）。"""
    ds = _make_dataset(client)  # full 档创建
    job = _make_job(client, ds["id"], f'SELECT * FROM "{ds["serverTable"]}"')
    client.put("/api/v1/settings/privacy-mode", json={"privacy_mode": "strict"},
               headers=CONFIRM)
    result = client.post(f"/api/v1/schedules/{job['id']}/run")
    # 闸门在 strict 档下阻断：run 失败且 error 含档位信息
    assert result.status_code == 201  # 手动触发接口本身成功
    data = result.json()["data"]
    assert data["run"]["status"] == "failed"
    assert data["job"]["consecutiveFailures"] == 1


def test_4040_missing_job(client):
    resp = client.get("/api/v1/schedules/no-such")
    assert resp.status_code == 404 and resp.json()["code"] == 4040
