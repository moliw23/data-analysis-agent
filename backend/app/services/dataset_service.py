"""服务端只读 SQL 守卫与执行（F2/AC-07：DDL/DML/多语句/危险语句 100% 拦截并给原因）。"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import sqlite3
import time
import uuid
from typing import Any

from app.core.errors import ConflictError, NotFoundError
from app.models.dataset import Dataset, DatasetQuery
from app.models.base import utcnow

_FORBIDDEN_KEYWORDS = (
    "insert", "update", "delete", "drop", "alter", "create", "replace",
    "truncate", "attach", "detach", "pragma", "vacuum", "reindex", "grant", "revoke",
)
_LEADING_COMMAND = re.compile(r"^\s*([a-zA-Z]+)")
_MULTI_STATEMENT = re.compile(r";\s*\S")
LIMIT = 200


def validate_sql(sql: str) -> tuple[bool, str | None]:
    """返回 (ok, 拦截原因)。只放行单条 SELECT/WITH。"""
    if not sql or not sql.strip():
        return False, "SQL 为空"
    body = sql.strip().rstrip(";").strip()
    m = _LEADING_COMMAND.match(body)
    if not m:
        return False, "无法识别的语句"
    verb = m.group(1).lower()
    if verb not in ("select", "with"):
        return False, f"只允许只读查询（SELECT/WITH），检测到 {verb.upper()}"
    rest = body[m.end():]
    for kw in _FORBIDDEN_KEYWORDS:
        if re.search(rf"\b{kw}\b", rest, re.IGNORECASE):
            return False, f"检测到禁用关键字 {kw.upper()}（服务端只读）"
    if _MULTI_STATEMENT.search(body):
        return False, "禁止多语句（检测到分号后仍有内容）"
    return True, None


def _ensure_limit(sql: str) -> str:
    if re.search(r"\bLIMIT\s+\d+\s*$", sql.strip().rstrip(";").strip(), re.IGNORECASE):
        return sql
    return sql.strip().rstrip(";") + f" LIMIT {LIMIT}"


def execute_readonly(app_engine, sql: str) -> dict[str, Any]:
    """在服务端 SQLite 上真实执行只读 SQL（只读连接），写审计。"""
    ok, reason = validate_sql(sql)
    if not ok:
        _audit(None, sql, "blocked", None, reason)
        raise ConflictError(f"SQL 被拦截：{reason}")

    started = time.perf_counter()
    try:
        raw = sqlite3.connect(f"file:{app_engine.url.database}?mode=ro", uri=True)
        try:
            cur = raw.execute(_ensure_limit(sql))
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = [list(r) for r in cur.fetchmany(LIMIT + 1)]
        finally:
            raw.close()
    except sqlite3.Error as exc:
        _audit(None, sql, "error", None, str(exc))
        raise ConflictError(f"SQL 执行失败：{exc}") from exc
    truncated = 1 if len(rows) > LIMIT else 0
    rows = rows[:LIMIT]
    ms = int((time.perf_counter() - started) * 1000)
    _audit(None, sql, "ok", len(rows), None)
    return {
        "columns": [{"name": c} for c in cols],
        "rows": rows,
        "rowCount": len(rows),
        "truncated": bool(truncated),
        "execMs": ms,
    }


def _audit(_db, sql: str, status: str, row_count: int | None, error: str | None) -> None:
    """审计由路由层传入 session 落库；此处仅占位避免双写。"""
    return None


def register_dataset_meta(db, *, name: str, row_count: int = 0, column_count: int = 0) -> Dataset:
    """登记元数据（server 模式；明细随后经 /upload 落库）。"""
    ds = Dataset(
        name=name[:200], source_type="upload", storage_mode="server",
        server_table=None, row_count=row_count, column_count=column_count,
    )
    db.add(ds)
    db.flush()
    return ds


def load_csv(db, ds: Dataset, csv_data: bytes) -> Dataset:
    """上传 CSV → 落服务端 SQLite 表 ds_<uuid8>，回写元数据。"""
    name = ds.name
    text_data = csv_data.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text_data))
    header = next(reader, None)
    if not header:
        raise ConflictError("CSV 无表头")
    rows = [r for r in reader if any(cell.strip() for cell in r)]

    # 数值列推断：整列可转 float → REAL，否则 TEXT（保证 ORDER BY/聚合语义正确）
    def _is_num(col_idx: int) -> bool:
        try:
            for r in rows:
                float(r[col_idx])
            return True
        except (ValueError, IndexError):
            return False

    types = ["REAL" if _is_num(i) else "TEXT" for i in range(len(header))]

    def _conv(i: int, val: str):
        return float(val) if types[i] == "REAL" and val.strip() else val

    table = f"ds_{uuid.uuid4().hex[:8]}"
    from app.core.config import get_settings

    raw = sqlite3.connect(get_settings().db_file)
    try:
        raw.execute(
            f'CREATE TABLE "{table}" ({", ".join(chr(34) + c.strip().replace(chr(34), "") + chr(34) + " " + t for c, t in zip(header, types))})'
        )
        ph = ", ".join("?" for _ in header)
        raw.executemany(
            f'INSERT INTO "{table}" VALUES ({ph})',
            [
                tuple(_conv(i, (r[i] if i < len(r) else "")) for i in range(len(header)))
                for r in rows
            ],
        )
        raw.commit()
    finally:
        raw.close()

    ds.server_table = table
    ds.row_count = len(rows)
    ds.column_count = len(header)
    ds.schema_json = json.dumps(
        [{"name": c, "type": t} for c, t in zip(header, types)], ensure_ascii=False)
    ds.sha256 = hashlib.sha256(csv_data).hexdigest()
    db.flush()
    return ds


def delete_dataset_table(db, ds: Dataset) -> None:
    """软删数据集同时物理删除其派生表（表是导入副本，非用户原始数据）。"""
    if ds.server_table:
        from app.core.config import get_settings

        raw = sqlite3.connect(get_settings().db_file)
        try:
            raw.execute(f'DROP TABLE IF EXISTS "{ds.server_table}"')
            raw.commit()
        finally:
            raw.close()
    ds.deleted_at = utcnow()
    db.flush()


def get_dataset(db, dataset_id: str) -> Dataset:
    row = db.get(Dataset, dataset_id)
    if row is None or row.deleted_at is not None:
        raise NotFoundError("数据集不存在")
    return row
