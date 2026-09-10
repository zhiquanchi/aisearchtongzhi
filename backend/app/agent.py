"""SSE 流式对话:基于 LangGraph 编排的 agent 循环。

图结构:START → chat → (有工具调用?) → tools → chat → ... → END

- chat 节点:调用千问(流式),通过 StreamWriter 把 reasoning/delta 增量
  以自定义事件发出;tool_call 增量拼接后写入 assistant 消息。
- tools 节点:执行 fetch_webpage,发出 tool_start/tool_end 事件。
- 事件协议与迁移前的手写循环完全一致,前端无需改动。
- 非标准的 reasoning_content / enable_search 参数仍走原生 openai SDK
  的 model_extra / extra_body,处理方式不变。
"""

import json
from typing import Annotated, Any, AsyncIterator, Literal, TypedDict

from langgraph.errors import GraphRecursionError
from langgraph.graph import END, START, StateGraph
from langgraph.types import StreamWriter
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


class AgentState(TypedDict):
    messages: list[dict[str, Any]]
    sources: list[dict[str, str]]
    usage: dict[str, Any] | None


def build_graph(enable_search: bool, web_fetch: bool, search_strategy: str):
    """按请求选项构建 agent 图(compile 很轻量,无需复用)。"""
    tools = [FETCH_WEBPAGE_TOOL] if web_fetch else None
    extra_body: dict[str, Any] = {}
    if enable_search:
        extra_body["enable_search"] = True
        extra_body["search_options"] = {
            "forced_search": True,
            "search_strategy": search_strategy,
        }

    async def chat_node(state: AgentState, writer: StreamWriter) -> dict:
        stream = await client.chat.completions.create(
            model=config.QWEN_MODEL,
            messages=state["messages"],
            tools=tools,
            stream=True,
            stream_options={"include_usage": True},
            extra_body=extra_body,
        )

        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        tool_calls: dict[int, dict[str, str]] = {}
        usage: dict[str, Any] | None = None

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
                writer({"type": "reasoning", "content": reasoning_piece})
            if delta.content:
                content_parts.append(delta.content)
                writer({"type": "delta", "content": delta.content})
            for tc in delta.tool_calls or []:
                slot = tool_calls.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function:
                    if tc.function.name:
                        slot["name"] += tc.function.name
                    if tc.function.arguments:
                        slot["arguments"] += tc.function.arguments

        assistant_msg: dict[str, Any] = {
            "role": "assistant",
            "content": "".join(content_parts) or "",
        }
        if tool_calls:
            assistant_msg["tool_calls"] = [
                {
                    "id": slot["id"] or f"call_{idx}",
                    "type": "function",
                    "function": {"name": slot["name"], "arguments": slot["arguments"] or "{}"},
                }
                for idx, slot in tool_calls.items()
            ]
        reasoning = "".join(reasoning_parts)
        if reasoning:
            # 思考模式下回传 assistant 消息必须保留 reasoning_content
            assistant_msg["reasoning_content"] = reasoning

        return {"messages": state["messages"] + [assistant_msg], "usage": usage}

    async def tools_node(state: AgentState, writer: StreamWriter) -> dict:
        assistant_msg = state["messages"][-1]
        messages = list(state["messages"])
        sources = list(state["sources"])

        for idx, call in enumerate(assistant_msg.get("tool_calls") or []):
            name = call["function"]["name"]
            try:
                args = json.loads(call["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            url = str(args.get("url", ""))
            writer({"type": "tool_start", "name": name, "url": url})

            if name == "fetch_webpage":
                try:
                    page = await fetch_webpage(url)
                    result = f"标题: {page['title']}\nURL: {url}\n\n{page['text']}"
                    ok = True
                except Exception as exc:  # noqa: BLE001 - 抓取失败要回传给模型
                    result = f"抓取失败: {exc}"
                    ok = False
                writer({"type": "tool_end", "name": name, "url": url, "ok": ok})
                if ok:
                    sources.append({"url": url, "title": page["title"]})
            else:
                result = f"未知工具: {name}"
                writer({"type": "tool_end", "name": name, "url": "", "ok": False})

            messages.append(
                {"role": "tool", "tool_call_id": call.get("id") or f"call_{idx}", "content": result}
            )
        return {"messages": messages, "sources": sources}

    def route_after_chat(state: AgentState) -> Literal["tools", "__end__"]:
        return "tools" if state["messages"][-1].get("tool_calls") else END

    graph = StateGraph(AgentState)
    graph.add_node("chat", chat_node)
    graph.add_node("tools", tools_node)
    graph.add_edge(START, "chat")
    graph.add_conditional_edges("chat", route_after_chat, ["tools", END])
    graph.add_edge("tools", "chat")
    return graph.compile()


async def stream_answer(
    messages: list[dict[str, str]],
    enable_search: bool,
    web_fetch: bool,
    search_strategy: str,
) -> AsyncIterator[str]:
    graph = build_graph(enable_search, web_fetch, search_strategy)
    initial: AgentState = {
        "messages": [{"role": "system", "content": SYSTEM_PROMPT}, *messages],
        "sources": [],
        "usage": None,
    }
    # 每轮工具调用占 chat+tools 两个步骤,与迁移前 MAX_TOOL_ROUNDS 的语义一致
    step_limit = config.MAX_TOOL_ROUNDS * 2
    last_state: AgentState = initial

    try:
        async for mode, payload in graph.astream(
            initial,
            config={"recursion_limit": step_limit},
            stream_mode=["custom", "values"],
        ):
            if mode == "custom":
                yield sse(payload)
            else:
                last_state = payload
    except GraphRecursionError:
        yield sse({"type": "error", "message": "达到最大工具调用轮数限制,已停止"})
        return
    except Exception as exc:  # noqa: BLE001 - 统一转为 SSE 错误事件
        yield sse({"type": "error", "message": f"执行失败: {exc}"})
        return

    if last_state["sources"]:
        yield sse({"type": "sources", "sources": last_state["sources"]})
    if last_state["usage"]:
        yield sse({"type": "usage", "usage": last_state["usage"]})
    yield sse({"type": "done"})
