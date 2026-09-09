"""SSE 流式对话:模型流式输出 + fetch_webpage 工具调用的 agent 循环。"""

import json
from typing import Any, AsyncIterator

from openai import AsyncOpenAI

from . import config
from .tools import FETCH_WEBPAGE_TOOL, fetch_webpage

SYSTEM_PROMPT = """你是"通智 AI 搜索",一个结合了联网搜索与网页抓取能力的智能搜索助手。

工作准则:
1. 涉及时效性信息(新闻、价格、天气、版本、赛事、政策等)时,基于联网搜索获得的信息回答,并注明信息时间。搜索结果中带有来源链接时,在回答末尾用"## 参考来源"小节以 Markdown 链接列出实际参考的条目(格式:[标题](链接))。
2. 当用户给出具体网页链接,或你需要某个网页的完整内容时,调用 fetch_webpage 工具抓取正文后再回答。
3. 使用与用户一致的语言回答(默认简体中文),用 Markdown 组织,重要结论放前面,要点清晰。
4. 不编造事实与链接;无法获取的信息要明确说明。"""

client = AsyncOpenAI(api_key=config.DASHSCOPE_API_KEY, base_url=config.DASHSCOPE_BASE_URL)


def sse(data: dict[str, Any]) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream_answer(
    messages: list[dict[str, str]],
    enable_search: bool,
    web_fetch: bool,
    search_strategy: str,
) -> AsyncIterator[str]:
    convo: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    convo += list(messages)

    tools = [FETCH_WEBPAGE_TOOL] if web_fetch else None
    extra_body: dict[str, Any] = {}
    if enable_search:
        extra_body["enable_search"] = True
        extra_body["search_options"] = {
            "forced_search": True,
            "search_strategy": search_strategy,
        }

    fetched_sources: list[dict[str, str]] = []
    usage: dict[str, Any] | None = None

    for _round in range(config.MAX_TOOL_ROUNDS):
        try:
            stream = await client.chat.completions.create(
                model=config.QWEN_MODEL,
                messages=convo,
                tools=tools,
                stream=True,
                stream_options={"include_usage": True},
                extra_body=extra_body,
            )
        except Exception as exc:  # noqa: BLE001 - 统一转为 SSE 错误事件
            yield sse({"type": "error", "message": f"调用模型失败: {exc}"})
            return

        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_calls: dict[int, dict[str, str]] = {}

        try:
            async for chunk in stream:
                if chunk.usage:
                    usage = chunk.usage.model_dump()
                if not chunk.choices:
                    continue
                delta = chunk.choices[0].delta
                if delta is None:
                    continue
                # reasoning_content 是非标准字段,SDK 不会声明为属性
                reasoning_piece = (delta.model_extra or {}).get("reasoning_content")
                if reasoning_piece:
                    reasoning_parts.append(reasoning_piece)
                    yield sse({"type": "reasoning", "content": reasoning_piece})
                if delta.content:
                    content_parts.append(delta.content)
                    yield sse({"type": "delta", "content": delta.content})
                for tc in delta.tool_calls or []:
                    slot = tool_calls.setdefault(
                        tc.index, {"id": "", "name": "", "arguments": ""}
                    )
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            slot["name"] += tc.function.name
                        if tc.function.arguments:
                            slot["arguments"] += tc.function.arguments
        except Exception as exc:  # noqa: BLE001
            yield sse({"type": "error", "message": f"读取模型流失败: {exc}"})
            return

        if not tool_calls:
            break

        # 把 assistant 的工具调用请求原样回填,再逐个执行并回传结果
        assistant_msg: dict[str, Any] = {
            "role": "assistant",
            "content": "".join(content_parts) or "",
            "tool_calls": [
                {
                    "id": slot["id"] or f"call_{idx}",
                    "type": "function",
                    "function": {"name": slot["name"], "arguments": slot["arguments"] or "{}"},
                }
                for idx, slot in tool_calls.items()
            ],
        }
        reasoning = "".join(reasoning_parts)
        if reasoning:
            # 思考模式下回传 assistant 消息必须保留 reasoning_content
            assistant_msg["reasoning_content"] = reasoning
        convo.append(assistant_msg)

        for idx, slot in tool_calls.items():
            name = slot["name"]
            try:
                args = json.loads(slot["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            url = str(args.get("url", ""))
            yield sse({"type": "tool_start", "name": name, "url": url})

            if name == "fetch_webpage":
                try:
                    page = await fetch_webpage(url)
                    result = f"标题: {page['title']}\nURL: {url}\n\n{page['text']}"
                    ok = True
                except Exception as exc:  # noqa: BLE001
                    result = f"抓取失败: {exc}"
                    ok = False
                yield sse({"type": "tool_end", "name": name, "url": url, "ok": ok})
                if ok:
                    fetched_sources.append({"url": url, "title": page["title"]})
            else:
                result = f"未知工具: {name}"
                yield sse({"type": "tool_end", "name": name, "url": "", "ok": False})

            convo.append({"role": "tool", "tool_call_id": slot["id"] or f"call_{idx}", "content": result})
    else:
        yield sse({"type": "error", "message": "达到最大工具调用轮数限制,已停止"})
        return

    if fetched_sources:
        yield sse({"type": "sources", "sources": fetched_sources})
    if usage:
        yield sse({"type": "usage", "usage": usage})
    yield sse({"type": "done"})
