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
        "run_at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT)"
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


def add_run(task_id: str, status: str, detail: str) -> None:
    with _lock:
        _conn.execute(
            "INSERT INTO runs (task_id, run_at, status, detail) VALUES (?, ?, ?, ?)",
            (task_id, _now(), status, detail),
        )
        _conn.commit()


def list_runs(task_id: str, limit: int = 30) -> list[dict[str, Any]]:
    with _lock:
        rows = _conn.execute(
            "SELECT id, task_id, run_at, status, detail FROM runs "
            "WHERE task_id = ? ORDER BY id DESC LIMIT ?",
            (task_id, limit),
        ).fetchall()
    return [
        {"id": r[0], "task_id": r[1], "run_at": r[2], "status": r[3], "detail": r[4]}
        for r in rows
    ]
