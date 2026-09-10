export interface SourceItem {
  url: string;
  title: string;
}

export interface ToolRecord {
  url: string;
  ok: boolean;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export type MsgStatus = 'pending' | 'streaming' | 'done' | 'error' | 'stopped';

export interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  reasoning: string;
  status: MsgStatus;
  /** 思考是否正在进行(用于控制思考区展开) */
  reasoningActive: boolean;
  /** 正在抓取的网页 URL */
  currentTool: string | null;
  tools: ToolRecord[];
  sources: SourceItem[];
  searched: boolean;
  usage?: UsageInfo;
  elapsed?: number;
  error?: string;
}

export interface SendOptions {
  enable_search: boolean;
  web_fetch: boolean;
  search_strategy: 'turbo' | 'max';
}

export interface ChatRequest extends SendOptions {
  messages: { role: string; content: string }[];
}

export type StreamEvent =
  | { type: 'reasoning'; content: string }
  | { type: 'delta'; content: string }
  | { type: 'tool_start'; name: string; url: string }
  | { type: 'tool_end'; name: string; url: string; ok: boolean }
  | { type: 'sources'; sources: SourceItem[] }
  | { type: 'usage'; usage: UsageInfo }
  | { type: 'error'; message: string }
  | { type: 'done' };

// ---------- 监控任务 ----------

export interface MonitorTask {
  id: string;
  name: string;
  type: 'page' | 'topic';
  url?: string;
  topic?: string;
  prompt?: string;
  schedule_type: 'interval' | 'daily';
  interval_minutes?: number;
  daily_time?: string;
  dingtalk_webhook: string;
  dingtalk_secret?: string;
  notify_on_change_only?: boolean;
  enabled: boolean;
  created_at?: string;
  last_run_at?: string | null;
  last_status?: string | null;
  next_run_at?: string | null;
}

export interface RunRecord {
  id: number;
  task_id: string;
  run_at: string;
  status: string;
  detail?: string;
  content?: string | null;
  duration_ms?: number | null;
}

// ---------- 搜索历史 ----------

export interface ConversationMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  msg_count: number;
}

export interface SavedMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceItem[];
  searched?: boolean;
}

export interface ConversationData extends ConversationMeta {
  messages: SavedMessage[];
}
