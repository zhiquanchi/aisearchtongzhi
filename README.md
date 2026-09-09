# 通智 AI 搜索

基于千问 `qwen3.8-flash` 的 AI 搜索应用,支持**联网搜索**与**网页抓取**,并提供**定时监控任务 + 钉钉通知**,前后端分离,流式输出。

## 功能

- **联网搜索**:调用千问 API 的 `enable_search` 参数(支持 快速 turbo / 深度 max 两种策略),模型基于实时搜索结果回答,并在回答末尾附"参考来源"。
- **网页抓取**:后端通过 function calling 提供 `fetch_webpage` 工具,模型在遇到 URL 或需要网页详情时自动抓取正文(html 提取、截断保护),抓取结果展示在"参考来源"面板。
- **流式体验**:SSE 逐字输出,支持"思考过程"折叠展示、停止生成、多轮追问、复制回答、token 用量统计。
- **监控任务**(配置页 `/config`):
  - 可配置多个任务,类型两种:**页面监控**(定时抓取指定 URL,LLM 对比新旧内容总结变化)与 **主题监控**(定时联网搜索生成主题简报);
  - 执行频率支持 固定间隔(分钟/小时)与 每天定时(HH:MM),基于 APScheduler;
  - 结果以 Markdown 消息推送到**钉钉群机器人**(支持加签),表单内可一键发送测试消息;
  - 页面任务可选"仅内容变化时通知"(首次运行建立基线);
  - 每个任务可随时"立即运行",执行历史在日志抽屉中查看(状态:已建基线/有变化/无变化/已推送/失败)。

## 项目结构

```
├── backend/               # Python (uv) + FastAPI
│   ├── app/
│   │   ├── main.py        # FastAPI 应用入口(启动时初始化存储与调度器)
│   │   ├── routes.py      # /api/health, /api/chat/stream (SSE), /api/tasks CRUD 等
│   │   ├── agent.py       # 流式对话 + 工具调用 agent 循环
│   │   ├── monitor.py     # 监控任务调度(APScheduler)与执行(抓取/搜索→LLM→钉钉)
│   │   ├── tools.py       # fetch_webpage 网页抓取工具(同步/异步)
│   │   ├── dingtalk.py    # 钉钉自定义机器人推送(支持加签)
│   │   ├── store.py       # SQLite 存储(任务 + 执行日志)
│   │   └── config.py      # 环境变量配置
│   ├── data/app.db        # 本地数据库(自动创建,勿提交)
│   ├── .env               # API Key(已配置,勿提交)
│   └── pyproject.toml
└── frontend/              # umi 4 + React 18 + antd 5
    ├── .umirc.ts          # 路由(/ 与 /config)、/api 代理到 127.0.0.1:8000
    └── src/
        ├── layouts/index.tsx      # 全局布局:顶部导航(搜索 / 任务配置)
        ├── pages/index.tsx        # 搜索页(首屏 + 会话)
        ├── pages/config.tsx       # 监控任务配置页(表格 + 表单 + 日志抽屉)
        ├── components/            # InputBar / MessageItem / ThinkingBlock / SourcesBlock
        ├── services/api.ts        # SSE 流式客户端 + 任务 API
        └── types.ts
```

## 快速开始

### 1. 启动后端(端口 8000)

```bash
cd backend
uv sync                                    # 安装依赖
uv run uvicorn app.main:app --reload --port 8000
```

API Key 已写在 `backend/.env`(`DASHSCOPE_API_KEY`),如需更换模型或地址,在 `.env` 中追加:

```
QWEN_MODEL=qwen3.8-flash
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
FETCH_MAX_CHARS=6000      # 抓取网页正文的最大字符数
MAX_TOOL_ROUNDS=5         # 工具调用最大轮数
```

### 2. 启动前端(端口 8001)

```bash
cd frontend
npm install
npm run dev
```

打开 http://localhost:8001 即可使用。开发态 `/api` 由 umi proxy 转发到后端 8000 端口。

## API 说明

`POST /api/chat/stream`,请求体:

```json
{
  "messages": [{ "role": "user", "content": "你的问题" }],
  "enable_search": true,
  "web_fetch": true,
  "search_strategy": "turbo"
}
```

响应为 SSE,事件类型:

| type | 说明 |
|---|---|
| `reasoning` | 思考过程增量文本 |
| `delta` | 回答增量文本(Markdown) |
| `tool_start` / `tool_end` | 网页抓取工具开始/结束(url, ok) |
| `sources` | 本次抓取过的网页列表 |
| `usage` | token 用量 |
| `error` / `done` | 出错 / 结束 |

监控任务接口:

| 方法与路径 | 说明 |
|---|---|
| `GET /api/tasks` | 任务列表(含 next_run_at 下次执行时间) |
| `POST /api/tasks` | 创建任务 |
| `PUT /api/tasks/{id}` | 修改任务(自动重新调度) |
| `DELETE /api/tasks/{id}` | 删除任务(同时清理调度与日志) |
| `POST /api/tasks/{id}/run` | 立即执行一次 |
| `GET /api/tasks/{id}/runs` | 执行日志(最近 30 条) |
| `POST /api/tasks/test-dingtalk` | 发送钉钉测试消息(webhook, secret) |

## 备注

- 千问平台 API 兼容 OpenAI 协议,文档:https://platform.qianwenai.com/docs/developer-guides/getting-started/introduction
- `enable_search` 的搜索结果由平台在服务端注入,接口不返回结构化引用列表;前端"参考来源"来自模型在回答中列出的链接 + 实际抓取过的网页。
- `reasoning_content` 为非标准字段,后端通过 `delta.model_extra` 读取,并在工具调用多轮回传时保留。
