import { useEffect, useRef, useState } from 'react';
import { App, Button, Drawer, Empty, Popconfirm } from 'antd';
import { DeleteOutlined, HistoryOutlined, PlusOutlined } from '@ant-design/icons';
import './index.less';
import InputBar from '@/components/InputBar';
import MessageItem from '@/components/MessageItem';
import {
  deleteConversation,
  getConversation,
  listConversations,
  saveConversation,
  streamChat,
} from '@/services/api';
import type { ChatMsg, ConversationMeta, SendOptions } from '@/types';

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

  // ---------- 搜索历史 ----------

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<ConversationMeta[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const currentIdRef = useRef<string | undefined>(undefined);
  const messagesRef = useRef<ChatMsg[]>([]);
  const prevGeneratingRef = useRef(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // 每轮问答结束后保存会话(含停止生成时的部分内容)
  useEffect(() => {
    if (prevGeneratingRef.current && !generating) {
      persist(messagesRef.current);
    }
    prevGeneratingRef.current = generating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating]);

  async function persist(msgs: ChatMsg[]) {
    const saved = msgs
      .filter((m) => m.role === 'user' || m.content)
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.role === 'assistant'
          ? { sources: m.sources, searched: m.searched }
          : {}),
      }));
    if (saved.length === 0) return;
    try {
      const title = (saved.find((m) => m.role === 'user')?.content || '未命名搜索').slice(0, 60);
      const res = await saveConversation(currentIdRef.current, title, saved);
      currentIdRef.current = res.id;
    } catch {
      // 历史保存失败不打断主流程
    }
  }

  const openHistory = async () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      setHistoryList(await listConversations());
    } catch {
      setHistoryList([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const loadConversation = async (id: string) => {
    try {
      const conv = await getConversation(id);
      currentIdRef.current = conv.id;
      setMessages(
        conv.messages.map((m, i) => ({
          id: `${conv.id}_${i}`,
          role: m.role,
          content: m.content,
          reasoning: '',
          status: 'done' as const,
          reasoningActive: false,
          currentTool: null,
          tools: [],
          sources: m.sources || [],
          searched: !!m.searched,
        })),
      );
      setHistoryOpen(false);
    } catch {
      message.error('加载会话失败');
    }
  };

  const removeConversation = async (id: string) => {
    try {
      await deleteConversation(id);
      if (currentIdRef.current === id) currentIdRef.current = undefined;
      setHistoryList((prev) => prev.filter((c) => c.id !== id));
    } catch {
      message.error('删除失败');
    }
  };

  const startNew = () => {
    if (generatingRef.current) return;
    currentIdRef.current = undefined;
    setMessages([]);
  };

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
          <div className="hero-actions">
            <Button type="text" icon={<HistoryOutlined />} onClick={openHistory}>
              历史搜索记录
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="chat" ref={chatRef}>
            <div className="chat-inner">
              <div className="chat-toolbar">
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={startNew}
                  disabled={generating}
                >
                  新对话
                </Button>
                <Button size="small" icon={<HistoryOutlined />} onClick={openHistory}>
                  历史记录
                </Button>
              </div>
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

      <Drawer
        title="历史搜索记录"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={420}
      >
        <Button
          block
          type="dashed"
          icon={<PlusOutlined />}
          disabled={generating}
          onClick={() => {
            startNew();
            setHistoryOpen(false);
          }}
        >
          开启新对话
        </Button>
        <div className="history-list">
          {historyList.length === 0 && !historyLoading ? (
            <Empty description="暂无历史记录" />
          ) : (
            historyList.map((c) => (
              <div
                key={c.id}
                className={`history-item${currentIdRef.current === c.id ? ' active' : ''}`}
                onClick={() => loadConversation(c.id)}
              >
                <div className="history-title">{c.title || '未命名搜索'}</div>
                <div className="history-meta">
                  <span>{c.updated_at}</span>
                  <span>{c.msg_count} 条消息</span>
                  <span className="history-del">
                    <Popconfirm
                      title="删除该记录?"
                      onConfirm={() => removeConversation(c.id)}
                      onCancel={(e) => e?.stopPropagation()}
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Drawer>
    </div>
  );
}
