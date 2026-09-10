import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  TimePicker,
  Timeline,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './config.less';
import {
  createTask,
  deleteTask,
  listRuns,
  listTasks,
  runTask,
  testDingtalk,
  updateTask,
} from '@/services/api';
import type { MonitorTask, RunRecord } from '@/types';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  baseline: { label: '已建基线', color: 'cyan' },
  changed: { label: '有变化', color: 'orange' },
  unchanged: { label: '无变化', color: 'default' },
  ok: { label: '已推送', color: 'green' },
  error: { label: '失败', color: 'red' },
};

function statusTag(status?: string | null) {
  if (!status) return <Tag>未运行</Tag>;
  const s = STATUS_MAP[status] || { label: status, color: 'default' };
  return <Tag color={s.color}>{s.label}</Tag>;
}

function scheduleText(t: MonitorTask) {
  if (t.schedule_type === 'daily') return `每天 ${t.daily_time || '09:00'}`;
  const m = t.interval_minutes || 60;
  return m % 60 === 0 ? `每 ${m / 60} 小时` : `每 ${m} 分钟`;
}

interface FormValues {
  name: string;
  type: 'page' | 'topic';
  url?: string;
  topic?: string;
  prompt?: string;
  schedule_type: 'interval' | 'daily';
  interval_value?: number;
  interval_unit?: 'minutes' | 'hours';
  daily_time?: Dayjs;
  dingtalk_webhook: string;
  dingtalk_secret?: string;
  notify_on_change_only?: boolean;
  enabled?: boolean;
}

export default function ConfigPage() {
  const { message } = App.useApp();
  const [tasks, setTasks] = useState<MonitorTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<MonitorTask | null>(null);
  const [logsFor, setLogsFor] = useState<MonitorTask | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [form] = Form.useForm<FormValues>();
  const taskType = Form.useWatch('type', form);
  const schedType = Form.useWatch('schedule_type', form);

  const refresh = async () => {
    setLoading(true);
    try {
      setTasks(await listTasks());
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载任务失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({
      type: 'page',
      schedule_type: 'interval',
      interval_value: 30,
      interval_unit: 'minutes',
      daily_time: dayjs('09:00', 'HH:mm'),
      notify_on_change_only: true,
      enabled: true,
    });
    setModalOpen(true);
  };

  const openEdit = (t: MonitorTask) => {
    setEditing(t);
    const minutes = t.interval_minutes || 60;
    form.setFieldsValue({
      ...t,
      interval_value: minutes % 60 === 0 ? minutes / 60 : minutes,
      interval_unit: minutes % 60 === 0 ? 'hours' : 'minutes',
      daily_time: t.daily_time ? dayjs(t.daily_time, 'HH:mm') : dayjs('09:00', 'HH:mm'),
    });
    setModalOpen(true);
  };

  const submit = async () => {
    let v: FormValues;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const payload: Partial<MonitorTask> = {
        name: v.name,
        type: v.type,
        url: v.url?.trim(),
        topic: v.topic?.trim(),
        prompt: v.prompt?.trim(),
        schedule_type: v.schedule_type,
        interval_minutes:
          v.schedule_type === 'daily'
            ? 60
            : v.interval_unit === 'hours'
              ? (v.interval_value || 1) * 60
              : v.interval_value || 30,
        daily_time: v.daily_time ? v.daily_time.format('HH:mm') : '09:00',
        dingtalk_webhook: v.dingtalk_webhook.trim(),
        dingtalk_secret: v.dingtalk_secret?.trim(),
        notify_on_change_only: v.notify_on_change_only ?? true,
        enabled: v.enabled ?? true,
      };
      if (editing) {
        await updateTask(editing.id, payload);
        message.success('任务已保存');
      } else {
        await createTask(payload);
        message.success('任务已创建');
      }
      setModalOpen(false);
      refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (t: MonitorTask, enabled: boolean) => {
    try {
      await updateTask(t.id, { ...t, enabled });
      refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const run = async (t: MonitorTask) => {
    try {
      await runTask(t.id);
      message.success('已触发执行,稍后可查看日志');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '触发失败');
    }
  };

  const remove = async (t: MonitorTask) => {
    try {
      await deleteTask(t.id);
      message.success('已删除');
      refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const showLogs = async (t: MonitorTask) => {
    setLogsFor(t);
    try {
      setRuns(await listRuns(t.id));
    } catch {
      setRuns([]);
    }
  };

  const handleTestDingtalk = async () => {
    try {
      const v = await form.validateFields(['dingtalk_webhook', 'dingtalk_secret']);
      await testDingtalk(v.dingtalk_webhook.trim(), v.dingtalk_secret?.trim() || '');
      message.success('测试消息已发送,请在钉钉群中查看');
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(e instanceof Error ? e.message : '发送失败');
    }
  };

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      width: 150,
      ellipsis: true,
      render: (v: string, t: MonitorTask) => (
        <a onClick={() => openEdit(t)} title={v}>
          {v}
        </a>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 96,
      render: (v: MonitorTask['type']) =>
        v === 'page' ? <Tag color="blue">页面监控</Tag> : <Tag color="purple">主题监控</Tag>,
    },
    {
      title: '监控对象',
      key: 'target',
      ellipsis: true,
      render: (_: unknown, t: MonitorTask) => (
        <span title={t.type === 'page' ? t.url : t.topic}>
          {t.type === 'page' ? t.url : t.topic}
        </span>
      ),
    },
    { title: '执行频率', key: 'sched', width: 110, render: (_: unknown, t: MonitorTask) => scheduleText(t) },
    {
      title: '下次执行',
      dataIndex: 'next_run_at',
      width: 150,
      render: (v: string | null) => (v ? <span>{v}</span> : <span className="muted">未启用</span>),
    },
    {
      title: '最近状态',
      key: 'last',
      width: 170,
      render: (_: unknown, t: MonitorTask) => (
        <Space size={6}>
          {statusTag(t.last_status)}
          <span className="muted">{t.last_run_at || ''}</span>
        </Space>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v: boolean, t: MonitorTask) => (
        <Switch size="small" checked={v} onChange={(checked) => toggleEnabled(t, checked)} />
      ),
    },
    {
      title: '操作',
      key: 'ops',
      width: 230,
      render: (_: unknown, t: MonitorTask) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => run(t)}>
            立即运行
          </Button>
          <Button size="small" type="link" onClick={() => showLogs(t)}>
            日志
          </Button>
          <Button size="small" type="link" onClick={() => openEdit(t)}>
            编辑
          </Button>
          <Popconfirm title="确定删除该任务?" onConfirm={() => remove(t)}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="config-page">
      <div className="config-inner">
        <div className="config-toolbar">
          <div>
            <h2 className="config-title">监控任务</h2>
            <p className="config-sub">定时监控网页或主题,结果推送到钉钉群</p>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} onClick={refresh} />
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建任务
            </Button>
          </Space>
        </div>

        <Table
          rowKey="id"
          columns={columns as never}
          dataSource={tasks}
          loading={loading}
          pagination={false}
          locale={{ emptyText: <Empty description="还没有监控任务,点击右上角「新建任务」创建" /> }}
        />
      </div>

      <Modal
        title={editing ? '编辑任务' : '新建监控任务'}
        open={modalOpen}
        width={560}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText="保存"
        confirmLoading={saving}
        destroyOnClose
        forceRender
      >
        <Form form={form} layout="vertical" className="task-form">
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请填写任务名称' }]}>
            <Input placeholder="如:竞品官网变更监控" maxLength={60} />
          </Form.Item>

          <Form.Item name="type" label="监控类型" rules={[{ required: true }]}>
            <Radio.Group
              optionType="button"
              options={[
                { value: 'page', label: '页面监控' },
                { value: 'topic', label: '主题监控' },
              ]}
            />
          </Form.Item>

          {taskType === 'page' && (
            <Form.Item
              name="url"
              label="监控网址"
              rules={[
                { required: true, message: '请填写要监控的网页地址' },
                { type: 'url', message: '请填写合法的 URL(http(s)://...)' },
              ]}
            >
              <Input placeholder="https://example.com/pricing" />
            </Form.Item>
          )}
          {taskType === 'topic' && (
            <Form.Item
              name="topic"
              label="监控主题"
              rules={[{ required: true, message: '请填写要监控的主题' }]}
            >
              <Input placeholder="如:AI Agent 行业最新动态" />
            </Form.Item>
          )}

          <Form.Item
            name="prompt"
            label="关注点(可选)"
            extra={
              <span className="muted">
                作为自定义指令交给 AI,页面监控与主题监控均生效;如:只关注考试时间安排的变动、忽略广告与友情链接
              </span>
            }
          >
            <Input placeholder="如:价格变化、新功能发布" />
          </Form.Item>

          <Form.Item name="schedule_type" label="执行频率" rules={[{ required: true }]}>
            <Radio.Group
              optionType="button"
              options={[
                { value: 'interval', label: '固定间隔' },
                { value: 'daily', label: '每天定时' },
              ]}
            />
          </Form.Item>
          {schedType === 'interval' ? (
            <Space.Compact className="interval-row">
              <Form.Item name="interval_value" noStyle>
                <InputNumber min={1} max={999} style={{ width: 110 }} />
              </Form.Item>
              <Form.Item name="interval_unit" noStyle>
                <Select
                  style={{ width: 90 }}
                  options={[
                    { value: 'minutes', label: '分钟' },
                    { value: 'hours', label: '小时' },
                  ]}
                />
              </Form.Item>
            </Space.Compact>
          ) : (
            <Form.Item name="daily_time" label="执行时间">
              <TimePicker format="HH:mm" />
            </Form.Item>
          )}

          <div className="form-divider">钉钉通知</div>
          <Form.Item
            name="dingtalk_webhook"
            label="钉钉机器人 Webhook"
            rules={[{ required: true, message: '请填写钉钉机器人 Webhook 地址' }]}
            extra={
              <span className="muted">
                钉钉群 → 设置 → 机器人 → 添加「自定义」机器人,安全设置建议选择「加签」
              </span>
            }
          >
            <Input placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
          </Form.Item>
          <Form.Item
            name="dingtalk_secret"
            label="加签密钥(SEC 开头,选填)"
            extra={
              <Button size="small" onClick={handleTestDingtalk}>
                发送测试消息
              </Button>
            }
          >
            <Input.Password placeholder="SECxxxxxxxx" />
          </Form.Item>

          {taskType === 'page' && (
            <Form.Item
              name="notify_on_change_only"
              label="仅内容变化时通知"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          )}
          <Form.Item name="enabled" label="立即启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={`执行日志 · ${logsFor?.name || ''}`}
        open={!!logsFor}
        onClose={() => setLogsFor(null)}
        width={560}
      >
        {runs.length === 0 ? (
          <Empty description="暂无执行记录" />
        ) : (
          <Timeline
            items={runs.map((r) => {
              const s = STATUS_MAP[r.status] || { label: r.status, color: 'gray' };
              return {
                color: r.status === 'error' ? 'red' : r.status === 'unchanged' ? 'gray' : 'green',
                children: (
                  <div className="run-item">
                    <div>
                      <span className="run-time">{r.run_at}</span>{' '}
                      <Tag color={s.color}>{s.label}</Tag>
                      {r.duration_ms != null && (
                        <span className="run-time">
                          耗时 {(r.duration_ms / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    {r.detail && <div className="run-detail">{r.detail}</div>}
                    {r.content && (
                      <Collapse
                        ghost
                        size="small"
                        className="run-content"
                        items={[
                          {
                            key: 'content',
                            label: <span className="run-time">查看生成内容</span>,
                            children: (
                              <div className="md run-md">
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                  {r.content}
                                </ReactMarkdown>
                              </div>
                            ),
                          },
                        ]}
                      />
                    )}
                  </div>
                ),
              };
            })}
          />
        )}
      </Drawer>
    </div>
  );
}
