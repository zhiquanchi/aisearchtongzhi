import { useState } from 'react';
import { Button, Input, Select, Switch, Tooltip } from 'antd';
import { BorderOutlined, SendOutlined } from '@ant-design/icons';
import type { SendOptions } from '@/types';

interface Props {
  generating: boolean;
  hero?: boolean;
  onSend: (text: string, opts: SendOptions) => void;
  onStop: () => void;
}

export default function InputBar({ generating, hero, onSend, onStop }: Props) {
  const [input, setInput] = useState('');
  const [searchOn, setSearchOn] = useState(true);
  const [fetchOn, setFetchOn] = useState(true);
  const [strategy, setStrategy] = useState<'turbo' | 'max'>('turbo');

  const submit = () => {
    const text = input.trim();
    if (!text || generating) return;
    onSend(text, { enable_search: searchOn, web_fetch: fetchOn, search_strategy: strategy });
    setInput('');
  };

  return (
    <div className={`composer-card${hero ? ' hero-card' : ''}`}>
      <Input.TextArea
        className="composer-textarea"
        placeholder="输入你的问题,Enter 发送,Shift+Enter 换行"
        variant="borderless"
        autoSize={{ minRows: 1, maxRows: 5 }}
        value={input}
        disabled={generating}
        onChange={(e) => setInput(e.target.value)}
        onPressEnter={(e) => {
          if (!e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-bar">
        <div className="composer-opts">
          <span className="opt">
            <Switch size="small" checked={searchOn} onChange={setSearchOn} />
            联网搜索
          </span>
          {searchOn && (
            <Select
              size="small"
              variant="filled"
              style={{ minWidth: 96 }}
              value={strategy}
              onChange={setStrategy}
              options={[
                { value: 'turbo', label: '快速搜索' },
                { value: 'max', label: '深度搜索' },
              ]}
            />
          )}
          <span className="opt">
            <Switch size="small" checked={fetchOn} onChange={setFetchOn} />
            网页抓取
          </span>
        </div>
        {generating ? (
          <Button shape="circle" icon={<BorderOutlined />} onClick={onStop} title="停止生成" />
        ) : (
          <Tooltip title="发送">
            <Button
              type="primary"
              shape="circle"
              icon={<SendOutlined />}
              disabled={!input.trim()}
              onClick={submit}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
