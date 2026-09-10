"""定时监控任务:调度(APScheduler)+ 执行(抓取/搜索 → LLM 摘要 → 钉钉推送)。"""

import hashlib
import threading
import time
from datetime import datetime
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from openai import OpenAI

from . import config, store
from .dingtalk import send_markdown
from .tools import fetch_webpage_sync

scheduler = BackgroundScheduler(timezone="Asia/Shanghai")

_sync_client = OpenAI(
    api_key=config.DASHSCOPE_API_KEY, base_url=config.DASHSCOPE_BASE_URL
)

MONITOR_SYSTEM_PROMPT = (
    "你是监控简报助手,输出简洁、信息密度高的中文简报,使用 Markdown 格式,"
    "不要输出与简报无关的内容。"
)


def init_scheduler() -> None:
    scheduler.start()
    for task in store.list_tasks():
        schedule_task(task)


def _job_id(task_id: str) -> str:
    return f"task-{task_id}"


def schedule_task(task: dict) -> None:
    """按任务配置(重)注册调度;任务被禁用时先移除。"""
    remove_task(task["id"])
    if not task.get("enabled"):
        return
    if task.get("schedule_type") == "daily":
        hour, minute = (int(x) for x in task.get("daily_time", "09:00").split(":")[:2])
        trigger = CronTrigger(hour=hour, minute=minute)
    else:
        minutes = max(5, int(task.get("interval_minutes") or 60))
        trigger = IntervalTrigger(minutes=minutes)
    scheduler.add_job(
        run_task_once,
        trigger,
        args=[task["id"]],
        id=_job_id(task["id"]),
        replace_existing=True,
        misfire_grace_time=3600,
    )


def remove_task(task_id: str) -> None:
    if scheduler.get_job(_job_id(task_id)):
        scheduler.remove_job(_job_id(task_id))


def next_run_at(task_id: str) -> str | None:
    job = scheduler.get_job(_job_id(task_id))
    if job and job.next_run_time:
        return job.next_run_time.strftime("%Y-%m-%d %H:%M:%S")
    return None


def run_now(task_id: str) -> None:
    threading.Thread(target=run_task_once, args=(task_id,), daemon=True).start()


def llm_complete(user_content: str, enable_search: bool) -> str:
    """后台任务用的非流式、关闭思考模式的调用。"""
    extra: dict[str, Any] = {"enable_thinking": False}
    if enable_search:
        extra["enable_search"] = True
        extra["search_options"] = {"forced_search": True, "search_strategy": "turbo"}
    resp = _sync_client.chat.completions.create(
        model=config.QWEN_MODEL,
        messages=[
            {"role": "system", "content": MONITOR_SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ],
        extra_body=extra,
    )
    return (resp.choices[0].message.content or "").strip()


def _notify(task: dict, title: str, md_text: str) -> None:
    send_markdown(
        task.get("dingtalk_webhook", ""),
        task.get("dingtalk_secret", ""),
        title,
        md_text,
    )


def _prompt_hint(task: dict) -> str:
    """把用户在"关注点"里填的自定义指令拼进提示词,两类任务均生效。"""
    hint = (task.get("prompt") or "").strip()
    if not hint:
        return ""
    return f"\n用户特别要求(必须遵守):{hint}"


def _run_page_task(task: dict) -> tuple[str, str, str | None, dict | None, str | None]:
    """页面监控。返回 (状态, 日志摘要, 钉钉消息 or None, 快照更新, 生成内容)。"""
    t0 = time.perf_counter()
    page = fetch_webpage_sync(task["url"])
    fetch_t = time.perf_counter() - t0
    text = page["text"]
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    snapshot = {"last_snapshot_hash": digest, "last_snapshot_text": text[:6000]}
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    hint = _prompt_hint(task)
    fetch_stat = f"抓取 {fetch_t:.1f}s · 「{page['title']}」{len(text)} 字符"

    first = not task.get("last_snapshot_hash")
    if first:
        t1 = time.perf_counter()
        summary = llm_complete(
            f"请总结下面这个网页的核心内容,300 字以内。{hint}\n\n标题:{page['title']}\n\n{text}",
            enable_search=False,
        )
        llm_t = time.perf_counter() - t1
        notify = (
            f"### 页面监控已建立基线:{task['name']}\n\n"
            f"- **页面**: {task['url']}\n\n{summary}\n\n> {now}"
        )
        detail = f"已建立基线 · {fetch_stat} · 摘要 {llm_t:.1f}s"
        return "baseline", detail, notify, snapshot, summary

    changed = digest != task["last_snapshot_hash"]
    if not changed and task.get("notify_on_change_only", True):
        return "unchanged", f"内容无变化 · {fetch_stat}", None, snapshot, None

    if changed:
        old = (task.get("last_snapshot_text") or "")[:3000]
        t1 = time.perf_counter()
        summary = llm_complete(
            "这是同一个网页的旧内容与新内容,请总结发生了哪些实质变化;"
            f"若无实质变化也请说明。条目化输出。{hint}\n\n"
            f"【旧内容】\n{old}\n\n【新内容】\n{text[:4000]}",
            enable_search=False,
        )
        llm_t = time.perf_counter() - t1
        title, status, detail = f"页面内容有变化:{task['name']}", "changed", "内容有变化"
    else:
        t1 = time.perf_counter()
        summary = llm_complete(
            f"请总结下面这个网页的要点,300 字以内。{hint}\n\n{text[:4000]}",
            enable_search=False,
        )
        llm_t = time.perf_counter() - t1
        title, status, detail = (
            f"页面监控简报:{task['name']}",
            "unchanged",
            "内容无变化(已按要求推送简报)",
        )
    detail = f"{detail} · {fetch_stat} · LLM {llm_t:.1f}s"

    notify = f"### {title}\n\n- **页面**: {task['url']}\n\n{summary}\n\n> {now}"
    return status, detail, notify, snapshot, summary


def _run_topic_task(task: dict) -> tuple[str, str, str | None, dict | None, str | None]:
    """主题监控:联网搜索生成简报。"""
    ask = f"请围绕主题「{task['topic']}」搜索最新信息"
    if task.get("prompt"):
        ask += f",重点关注:{task['prompt']}"
    ask += (
        ",输出一份简明简报:3-6 条要点,每条尽量附来源链接,末尾用"
        "「## 参考来源」列出实际参考的链接。"
    )
    t0 = time.perf_counter()
    digest = llm_complete(ask, enable_search=True)
    llm_t = time.perf_counter() - t0
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    notify = f"### 主题监控简报:{task['name']}\n\n{digest}\n\n> {now}"
    detail = f"简报已生成 · 检索+生成 {llm_t:.1f}s · {len(digest)} 字符"
    return "ok", detail, notify, None, digest


def run_task_once(task_id: str) -> None:
    task = store.get_task(task_id)
    if task is None:
        return

    t0 = time.perf_counter()
    try:
        if task["type"] == "page":
            status, detail, notify, snapshot, content = _run_page_task(task)
        else:
            status, detail, notify, snapshot, content = _run_topic_task(task)
    except Exception as exc:  # noqa: BLE001 - 后台任务统一记录为失败
        store.add_run(
            task_id,
            "error",
            f"执行失败: {exc}"[:1000],
            duration_ms=int((time.perf_counter() - t0) * 1000),
        )
        store.update_task(task_id, {"last_run_at": store._now(), "last_status": "error"})
        return

    if notify:
        t1 = time.perf_counter()
        try:
            _notify(task, task["name"], notify)
        except Exception as exc:  # noqa: BLE001
            store.add_run(
                task_id,
                "error",
                f"钉钉推送失败(耗时 {time.perf_counter() - t1:.1f}s): {exc}"[:1000],
                content=content,
                duration_ms=int((time.perf_counter() - t0) * 1000),
            )
            store.update_task(task_id, {"last_run_at": store._now(), "last_status": "error"})
            return
        detail = f"{detail} · 推送 {time.perf_counter() - t1:.1f}s"

    patch: dict[str, Any] = {"last_run_at": store._now(), "last_status": status}
    if snapshot:
        patch.update(snapshot)
    store.add_run(
        task_id,
        status,
        detail,
        content=content,
        duration_ms=int((time.perf_counter() - t0) * 1000),
    )
    store.update_task(task_id, patch)
