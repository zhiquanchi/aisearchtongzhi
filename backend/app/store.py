"""SQLite 任务存储:任务表 + 执行日志表。任务整体以 JSON blob 存储。"""

import json
import sqlite3
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "app.db"

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def init() -> None:
    global _conn
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    _conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks ("
        "id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    _conn.execute(
        "CREATE TABLE IF NOT EXISTS runs ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, "
        "run_at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT, "
        "content TEXT, duration_ms INTEGER)"
    )
    # 旧库迁移:补齐 runs 表后加的列
    run_cols = {r[1] for r in _conn.execute("PRAGMA table_info(runs)")}
    if "content" not in run_cols:
        _conn.execute("ALTER TABLE runs ADD COLUMN content TEXT")
    if "duration_ms" not in run_cols:
        _conn.execute("ALTER TABLE runs ADD COLUMN duration_ms INTEGER")
    _conn.execute(
        "CREATE TABLE IF NOT EXISTS conversations ("
        "id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', "
        "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL)"
    )
    _conn.commit()


def list_tasks() -> list[dict[str, Any]]:
    with _lock:
        rows = _conn.execute("SELECT data FROM tasks ORDER BY created_at DESC").fetchall()
    return [json.loads(r[0]) for r in rows]


def get_task(task_id: str) -> dict[str, Any] | None:
    with _lock:
        row = _conn.execute("SELECT data FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return json.loads(row[0]) if row else None


def create_task(data: dict[str, Any]) -> dict[str, Any]:
    task = {
        "id": uuid.uuid4().hex[:12],
        "created_at": _now(),
        "last_run_at": None,
        "last_status": None,
        "last_snapshot_hash": None,
        "last_snapshot_text": None,
        **data,
    }
    with _lock:
        _conn.execute(
            "INSERT INTO tasks (id, data, created_at) VALUES (?, ?, ?)",
            (task["id"], json.dumps(task, ensure_ascii=False), task["created_at"]),
        )
        _conn.commit()
    return task


def update_task(task_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    task = get_task(task_id)
    if task is None:
        return None
    task.update(patch)
    with _lock:
        _conn.execute(
            "UPDATE tasks SET data = ? WHERE id = ?",
            (json.dumps(task, ensure_ascii=False), task_id),
        )
        _conn.commit()
    return task


def delete_task(task_id: str) -> None:
    with _lock:
        _conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        _conn.execute("DELETE FROM runs WHERE task_id = ?", (task_id,))
        _conn.commit()


def add_run(
    task_id: str,
    status: str,
    detail: str = "",
    content: str | None = None,
    duration_ms: int | None = None,
) -> None:
    with _lock:
        _conn.execute(
            "INSERT INTO runs (task_id, run_at, status, detail, content, duration_ms) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (task_id, _now(), status, detail, content, duration_ms),
        )
        _conn.commit()


def list_runs(task_id: str, limit: int = 30) -> list[dict[str, Any]]:
    with _lock:
        rows = _conn.execute(
            "SELECT id, task_id, run_at, status, detail, content, duration_ms FROM runs "
            "WHERE task_id = ? ORDER BY id DESC LIMIT ?",
            (task_id, limit),
        ).fetchall()
    return [
        {
            "id": r[0],
            "task_id": r[1],
            "run_at": r[2],
            "status": r[3],
            "detail": r[4],
            "content": r[5],
            "duration_ms": r[6],
        }
        for r in rows
    ]


# ---------- 搜索历史对话 ----------


def upsert_conversation(conv_id: str | None, title: str, messages: list[dict]) -> str:
    now = _now()
    data = json.dumps({"messages": messages}, ensure_ascii=False)
    with _lock:
        if conv_id:
            row = _conn.execute(
                "SELECT created_at FROM conversations WHERE id = ?", (conv_id,)
            ).fetchone()
            created = row[0] if row else now
        else:
            conv_id = uuid.uuid4().hex[:12]
            created = now
        _conn.execute(
            "INSERT INTO conversations (id, title, created_at, updated_at, data) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET title = excluded.title, "
            "updated_at = excluded.updated_at, data = excluded.data",
            (conv_id, title, created, now, data),
        )
        _conn.commit()
    return conv_id


def list_conversations(limit: int = 100) -> list[dict[str, Any]]:
    with _lock:
        rows = _conn.execute(
            "SELECT id, title, created_at, updated_at, data FROM conversations "
            "ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    out = []
    for r in rows:
        messages = json.loads(r[4]).get("messages", [])
        out.append(
            {
                "id": r[0],
                "title": r[1],
                "created_at": r[2],
                "updated_at": r[3],
                "msg_count": len(messages),
            }
        )
    return out


def get_conversation(conv_id: str) -> dict[str, Any] | None:
    with _lock:
        row = _conn.execute(
            "SELECT id, title, created_at, updated_at, data FROM conversations WHERE id = ?",
            (conv_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "title": row[1],
        "created_at": row[2],
        "updated_at": row[3],
        "messages": json.loads(row[4]).get("messages", []),
    }


def delete_conversation(conv_id: str) -> None:
    with _lock:
        _conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
        _conn.commit()
