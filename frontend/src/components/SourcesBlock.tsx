import { useMemo } from 'react';
import { Tag } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import type { SourceItem, ToolRecord } from '@/types';

/** 从回答 Markdown 的"参考来源"小节提取链接 */
function extractMdSources(md: string): SourceItem[] {
  const idx = md.indexOf('参考来源');
  if (idx === -1) return [];
  const tail = md.slice(idx);
  const out: SourceItem[] = [];
  const re = /\[([^\]]{1,80})\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tail)) && out.length < 8) {
    out.push({ title: m[1], url: m[2] });
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface Props {
  tools: ToolRecord[];
  content: string;
}

/** 参考来源面板:抓取过的网页 + 回答中列出的来源链接(按 URL 去重) */
export default function SourcesBlock({ tools, content }: Props) {
  const sources = useMemo(() => {
    const seen = new Set<string>();
    const all: SourceItem[] = [];
    for (const s of [
      ...tools.map((t) => ({ url: t.url, title: t.url })),
      ...extractMdSources(content),
    ]) {
      if (!s.url || seen.has(s.url)) continue;
      seen.add(s.url);
      all.push(s);
    }
    return all;
  }, [tools, content]);

  if (sources.length === 0) return null;

  return (
    <div className="sources">
      <div className="sources-title">
        <LinkOutlined /> 参考来源 · {sources.length}
      </div>
      <div className="source-chips">
        {sources.map((s) => (
          <Tag key={s.url} className="source-chip">
            <a href={s.url} target="_blank" rel="noreferrer" title={s.url}>
              {s.title === s.url ? hostOf(s.url) : s.title}
            </a>
          </Tag>
        ))}
      </div>
    </div>
  );
}
