import type { ChatRequest, MonitorTask, RunRecord, StreamEvent } from '@/types';

/** 通过 SSE 流式请求后端,逐事件回调。 */
export async function streamChat(
  params: ChatRequest,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const resp = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal,
  });
  if (!resp.ok) {
    throw new Error(`请求失败: HTTP ${resp.status}`);
  }
  if (!resp.body) {
    throw new Error('当前浏览器不支持流式读取');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          onEvent(JSON.parse(payload) as StreamEvent);
        } catch {
          // 忽略无法解析的帧
        }
      }
    }
  }
}

// ---------- 监控任务 API ----------

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({} as { detail?: string }));
    throw new Error(body.detail || `请求失败: HTTP ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export const listTasks = () => http<MonitorTask[]>('/api/tasks');

export const createTask = (task: Partial<MonitorTask>) =>
  http<MonitorTask>('/api/tasks', { method: 'POST', body: JSON.stringify(task) });

export const updateTask = (id: string, task: Partial<MonitorTask>) =>
  http<MonitorTask>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(task) });

export const deleteTask = (id: string) =>
  http<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' });

export const runTask = (id: string) =>
  http<{ ok: boolean }>(`/api/tasks/${id}/run`, { method: 'POST' });

export const listRuns = (id: string) => http<RunRecord[]>(`/api/tasks/${id}/runs`);

export const testDingtalk = (webhook: string, secret: string) =>
  http<{ ok: boolean }>('/api/tasks/test-dingtalk', {
    method: 'POST',
    body: JSON.stringify({ webhook, secret }),
  });
