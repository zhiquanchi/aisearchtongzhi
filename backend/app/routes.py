from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import config, monitor, store
from .agent import stream_answer
from .dingtalk import send_markdown

router = APIRouter()


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessageIn] = Field(min_length=1)
    enable_search: bool = True
    web_fetch: bool = True
    search_strategy: Literal["turbo", "max"] = "turbo"


@router.get("/api/health")
async def health() -> dict:
    has_key = bool(config.DASHSCOPE_API_KEY)
    return {"status": "ok", "model": config.QWEN_MODEL, "api_key_configured": has_key}


@router.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    if not config.DASHSCOPE_API_KEY:
        return StreamingResponse(
            iter(['data: {"type": "error", "message": "未配置 DASHSCOPE_API_KEY,请检查 backend/.env"}\n\n']),
            media_type="text/event-stream",
        )

    return StreamingResponse(
        stream_answer(
            messages=[m.model_dump() for m in req.messages],
            enable_search=req.enable_search,
            web_fetch=req.web_fetch,
            search_strategy=req.search_strategy,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------- 监控任务 ----------


class TaskIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    type: Literal["page", "topic"]
    url: str = ""
    topic: str = ""
    prompt: str = ""
    schedule_type: Literal["interval", "daily"] = "interval"
    interval_minutes: int = Field(default=60, ge=5, le=60 * 24 * 7)
    daily_time: str = "09:00"
    dingtalk_webhook: str = Field(min_length=1)
    dingtalk_secret: str = ""
    notify_on_change_only: bool = True
    enabled: bool = True


class DingTalkTestIn(BaseModel):
    webhook: str
    secret: str = ""


class ConversationIn(BaseModel):
    id: str | None = None
    title: str = Field(default="", max_length=200)
    messages: list[dict[str, Any]] = Field(default_factory=list)


def _validate_task(t: TaskIn) -> str | None:
    if t.type == "page" and not t.url.strip():
        return "页面监控必须填写监控网址"
    if t.type == "topic" and not t.topic.strip():
        return "主题监控必须填写监控主题"
    if t.schedule_type == "daily":
        parts = t.daily_time.split(":")
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            return "执行时间格式应为 HH:MM"
        hour, minute = (int(p) for p in parts)
        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return "执行时间不合法"
    return None


def _task_out(t: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in t.items() if not k.startswith("last_snapshot")}
    out["next_run_at"] = monitor.next_run_at(t["id"])
    return out


@router.get("/api/tasks")
async def list_tasks() -> list[dict]:
    return [_task_out(t) for t in store.list_tasks()]


@router.post("/api/tasks")
async def create_task(t: TaskIn) -> dict:
    if err := _validate_task(t):
        raise HTTPException(400, err)
    task = store.create_task(t.model_dump())
    monitor.schedule_task(task)
    return _task_out(task)


@router.put("/api/tasks/{task_id}")
async def update_task(task_id: str, t: TaskIn) -> dict:
    if store.get_task(task_id) is None:
        raise HTTPException(404, "任务不存在")
    if err := _validate_task(t):
        raise HTTPException(400, err)
    task = store.update_task(task_id, t.model_dump())
    monitor.schedule_task(task)
    return _task_out(task)


@router.delete("/api/tasks/{task_id}")
async def delete_task(task_id: str) -> dict:
    monitor.remove_task(task_id)
    store.delete_task(task_id)
    return {"ok": True}


@router.post("/api/tasks/{task_id}/run")
async def run_task(task_id: str) -> dict:
    if store.get_task(task_id) is None:
        raise HTTPException(404, "任务不存在")
    monitor.run_now(task_id)
    return {"ok": True}


@router.get("/api/tasks/{task_id}/runs")
async def list_runs(task_id: str) -> list[dict]:
    return store.list_runs(task_id)


@router.post("/api/tasks/test-dingtalk")
async def test_dingtalk(body: DingTalkTestIn) -> dict:
    try:
        send_markdown(
            body.webhook,
            body.secret,
            "通智 AI 搜索",
            "### 配置成功 🎉\n\n这是一条来自「通智 AI 搜索」的测试消息,钉钉机器人配置可用。",
        )
    except Exception as exc:  # noqa: BLE001 - 把钉钉返回的错误透传给前端
        raise HTTPException(400, f"发送失败: {exc}")
    return {"ok": True}


# ---------- 搜索历史对话 ----------


@router.get("/api/conversations")
async def list_conversations() -> list[dict]:
    return store.list_conversations()


@router.get("/api/conversations/{conv_id}")
async def get_conversation(conv_id: str) -> dict:
    conv = store.get_conversation(conv_id)
    if conv is None:
        raise HTTPException(404, "会话不存在")
    return conv


@router.post("/api/conversations")
async def save_conversation(body: ConversationIn) -> dict:
    conv_id = store.upsert_conversation(body.id, body.title.strip(), body.messages)
    return {"id": conv_id}


@router.delete("/api/conversations/{conv_id}")
async def delete_conversation(conv_id: str) -> dict:
    store.delete_conversation(conv_id)
    return {"ok": True}
