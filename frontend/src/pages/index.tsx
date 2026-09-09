import { useEffect, useRef, useState } from 'react';
import { App } from 'antd';
import './index.less';
import InputBar from '@/components/InputBar';
import MessageItem from '@/components/MessageItem';
import { streamChat } from '@/services/api';
import type { ChatMsg, SendOptions } from '@/types';

const SUGGESTIONS = [
  '最近 AI 行业有什么值得关注的大事?',
  '今天杭州天气怎么样,适合穿什么?',
  '总结这个网页的内容: https://example.com',
  '2026 外滩大会有哪些亮点?',
];

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function HomePage() {
  const { message } = App.useApp();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const patch = (id: string, fn: (m: ChatMsg) => ChatMsg) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)));

  // 有新内容时自动滚动到底部
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = (text: string, opts: SendOptions) => {
    if (generatingRef.current) return;
    const userMsg: ChatMsg = {
      id: uid(),
      role: 'user',
      content: text,
      reasoning: '',
      status: 'done',
      reasoningActive: false,
      currentTool: null,
      tools: [],
      sources: [],
      searched: false,
    };
    const aiId = uid();
    const aiMsg: ChatMsg = {
      id: aiId,
      role: 'assistant',
      content: '',
      reasoning: '',
      status: 'pending',
      reasoningActive: false,
      currentTool: null,
      tools: [],
      sources: [],
      searched: opts.enable_search,
    };
    const history = messages
      .filter((m) => m.status !== 'error')
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    generatingRef.current = true;
    setGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = Date.now();

    const handleEvent = (ev: import('@/types').StreamEvent) => {
      patch(aiId, (m) => {
        switch (ev.type) {
          case 'reasoning':
            return {
              ...m,
              status: 'streaming',
              reasoningActive: true,
              reasoning: m.reasoning + ev.content,
            };
          case 'delta':
            return {
              ...m,
              status: 'streaming',
              reasoningActive: false,
              content: m.content + ev.content,
            };
          case 'tool_start':
            return { ...m, status: 'streaming', currentTool: ev.url };
          case 'tool_end':
            return {
              ...m,
              status: 'streaming',
              currentTool: null,
              tools: [...m.tools, { url: ev.url, ok: ev.ok }],
            };
          case 'sources':
            return { ...m, sources: ev.sources };
          case 'usage':
            return { ...m, usage: ev.usage };
          case 'error':
            return { ...m, status: 'error', error: ev.message };
          case 'done':
            return { ...m, status: m.status === 'error' ? 'error' : 'done' };
          default:
            return m;
        }
      });
    };

    streamChat(
      { messages: [...history, { role: 'user', content: text }], ...opts },
      handleEvent,
      controller.signal,
    )
      .then(() => {
        patch(aiId, (m) => ({
          ...m,
          status: m.status === 'error' ? 'error' : 'done',
          reasoningActive: false,
          elapsed: (Date.now() - startedAt) / 1000,
        }));
      })
      .catch((err: unknown) => {
        const aborted = err instanceof DOMException && err.name === 'AbortError';
        patch(aiId, (m) => ({
          ...m,
          status: aborted ? 'stopped' : 'error',
          reasoningActive: false,
          error: aborted ? undefined : err instanceof Error ? err.message : '网络错误',
          elapsed: (Date.now() - startedAt) / 1000,
        }));
        if (!aborted) message.error('请求失败,请检查后端服务是否启动');
      })
      .finally(() => {
        generatingRef.current = false;
        setGenerating(false);
        abortRef.current = null;
      });
  };

  const stop = () => abortRef.current?.abort();

  const empty = messages.length === 0;

  return (
    <div className="page">
      {empty ? (
        <div className="hero">
          <h1 className="hero-title">通智 AI 搜索</h1>
          <p className="hero-sub">联网搜索 · 网页抓取 · 流式回答</p>
          <InputBar generating={generating} hero onSend={send} onStop={stop} />
          <div className="suggests">
            {SUGGESTIONS.map((s) => (
              <span
                key={s}
                className="suggest-chip"
                onClick={() =>
                  send(s, { enable_search: true, web_fetch: true, search_strategy: 'turbo' })
                }
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="chat" ref={chatRef}>
            <div className="chat-inner">
              {messages.map((m) => (
                <MessageItem key={m.id} msg={m} />
              ))}
            </div>
          </div>
          <div className="composer-fixed">
            <div className="composer-fixed-inner">
              <InputBar generating={generating} onSend={send} onStop={stop} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
