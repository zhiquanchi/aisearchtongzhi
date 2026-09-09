import { Alert, Button, Spin, Tag, Tooltip } from 'antd';
import {
  CheckOutlined,
  CopyOutlined,
  GlobalOutlined,
  LinkOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMsg } from '@/types';
import ThinkingBlock from './ThinkingBlock';
import SourcesBlock from './SourcesBlock';

function shortUrl(url: string, max = 42): string {
  const clean = url.replace(/^https?:\/\//, '');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function AiMessage({ msg }: { msg: ChatMsg }) {
  const [copied, setCopied] = useState(false);
  const busy =
    msg.status === 'pending' ||
    msg.status === 'streaming';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略复制失败
    }
  };

  return (
    <div className="msg-ai">
      <div className="msg-ai-tags">
        {msg.searched && (
          <Tag icon={<GlobalOutlined />} color="processing">
            联网搜索
          </Tag>
        )}
        {msg.currentTool && (
          <Tag icon={<Spin size="small" />} color="blue">
            正在抓取 {shortUrl(msg.currentTool)}
          </Tag>
        )}
        {msg.tools.some((t) => t.ok) && !msg.currentTool && (
          <Tag icon={<LinkOutlined />}>
            已读取 {msg.tools.filter((t) => t.ok).length} 个网页
          </Tag>
        )}
      </div>

      {(msg.reasoning || msg.reasoningActive) && (
        <ThinkingBlock text={msg.reasoning} active={msg.reasoningActive} />
      )}

      {msg.status === 'pending' &&
        !msg.reasoning &&
        !msg.currentTool &&
        msg.content === '' && (
          <div className="thinking-label" style={{ padding: '4px 0' }}>
            <Spin size="small" /> 正在思考…
          </div>
        )}

      {msg.content && (
        <div className="md">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {msg.content}
          </ReactMarkdown>
          {busy && msg.status === 'streaming' && <span className="cursor" />}
        </div>
      )}

      {msg.status === 'error' && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 8 }}
          message={msg.error || '生成失败,请重试'}
        />
      )}

      <SourcesBlock tools={msg.tools} content={msg.content} />

      {(msg.status === 'done' || msg.status === 'stopped' || msg.status === 'error') && (
        <div className="msg-footer">
          {msg.elapsed !== undefined && <span>用时 {msg.elapsed.toFixed(1)} 秒</span>}
          {msg.usage && (
            <span>
              tokens: {msg.usage.prompt_tokens} 输入 / {msg.usage.completion_tokens} 输出
            </span>
          )}
          {msg.status === 'stopped' && <span>已停止生成</span>}
          {msg.content && (
            <Tooltip title="复制回答">
              <Button
                type="text"
                size="small"
                icon={copied ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
                onClick={copy}
              />
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

export default function MessageItem({ msg }: { msg: ChatMsg }) {
  if (msg.role === 'user') {
    return (
      <div className="msg-user">
        <div className="bubble-user">{msg.content}</div>
        <div className="avatar-user">
          <UserOutlined />
        </div>
      </div>
    );
  }
  return <AiMessage msg={msg} />;
}
