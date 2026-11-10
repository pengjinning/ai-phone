import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Steps,
  Tag,
  Timeline,
  Typography,
} from 'antd'
import { PhoneOutlined } from '@ant-design/icons'
import type { CallEvent, LineStatus } from '../../shared/types'
import { api, ApiError } from '../api/client'
import { useStatus } from '../hooks/useStatus'
import { OUTCOME_TEXT } from './Dashboard'
import type { CallResponse } from '../api/client'

const EVENT_TEXT: Record<string, (e: any) => string> = {
  created: (e) => `已创建通话 ${e.call_id}`,
  dialling: () => `正在拨号…`,
  ringing: () => `响铃中…`,
  answered: () => `已接听`,
  turn: (e) => `第 ${e.turn} 轮对话,首句延迟 ${e.first_audible_ms} ms`,
  busy: () => `占线`,
  no_answer: () => `无应答`,
  rejected: (e) => `被拒${e.reason ? ` (${e.reason})` : ''}`,
  redirected: () => `已转移`,
  ended: (e) => `结束: ${OUTCOME_TEXT[e.reason] ?? e.reason}${e.detail ? ` — ${e.detail}` : ''}`,
}

export default function CallPage() {
  const { message } = AntApp.useApp()
  const { status, events: liveEvents } = useStatus()
  const [form] = Form.useForm()
  const [mode, setMode] = useState<'agent' | 'relay'>('agent')
  const [promptLen, setPromptLen] = useState(0)
  const [calling, setCalling] = useState(false)
  const [events, setEvents] = useState<CallEvent[]>([])
  const [result, setResult] = useState<CallResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const lines = useMemo(() => Object.values(status?.lines ?? {}) as LineStatus[], [status])

  const onFinish = async (values: {
    to: string
    line?: string
    mode: 'agent' | 'relay'
    prompt?: string
    timeout_sec: number
  }) => {
    setCalling(true)
    setEvents([])
    setResult(null)
    setError(null)
    try {
      const res = await api.call({
        to: values.to.trim(),
        line: values.line ?? null,
        prompt: values.mode === 'agent' ? values.prompt?.trim() || null : null,
        relay: values.mode === 'relay',
        timeout_sec: values.timeout_sec,
      })
      setResult(res)
      if (res.ok && values.mode === 'agent') {
        message.success('通话已完成')
      } else if (res.ok && values.mode === 'relay') {
        message.success('已接听,请到中继控制台继续对话')
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setCalling(false)
    }
  }

  // mirror live SSE events into the progress timeline while a call runs
  useEffect(() => {
    if (!calling) return
    // only progress events from this call (they all carry our call_id once created)
    const ours = liveEvents.filter((e) => e.event !== 'ended' && !('ok' in e))
    if (ours.length) setEvents(ours)
  }, [liveEvents, calling])

  const currentStep = (() => {
    const last = events[events.length - 1]
    if (!last) return 0
    if (last.event === 'ended' || last.event === 'busy' || last.event === 'no_answer' || last.event === 'rejected')
      return 3
    if (last.event === 'answered' || last.event === 'turn') return 2
    return 1
  })()

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="新通话" size="small">
        <Form
          form={form}
          layout="vertical"
          initialValues={{ mode: 'agent', timeout_sec: 30 }}
          onFinish={onFinish}
          disabled={calling}
          style={{ maxWidth: 640 }}
        >
          <Form.Item
            name="to"
            label="对方号码 / SIP 地址"
            rules={[
              { required: true, message: '请输入号码' },
              {
                validator: (_, v) =>
                  !v || /^\+?[0-9]+$/.test(v.trim()) || v.trim().startsWith('sip:')
                    ? Promise.resolve()
                    : Promise.reject(new Error('E.164 号码(如 +15555550100)或 sip: URI')),
              },
            ]}
          >
            <Input placeholder="+15555550100 或 sip:agent@127.0.0.1" style={{ maxWidth: 360 }} />
          </Form.Item>

          <Form.Item name="line" label="线路(可选,多线路时指定)" style={{ maxWidth: 360 }}>
            <Select
              allowClear
              placeholder="自动选择"
              options={lines.map((l) => ({
                value: l.id,
                label: `${l.id} (${l.kind === 'trunk' ? '中继' : 'SIP'} · ${l.address})`,
              }))}
            />
          </Form.Item>

          <Form.Item label="模式">
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              <Radio.Button value="agent">电话代理 — AI 自动对话</Radio.Button>
              <Radio.Button value="relay">中继 — 我来对话</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {mode === 'agent' && (
            <Form.Item
              name="prompt"
              label="通话任务(电话代理模式;留空则 AI 自由寒暄)"
              extra={`最多 4000 字符,当前 ${promptLen}/4000`}
            >
              <Input.TextArea
                rows={3}
                maxLength={4000}
                showCount
                placeholder="例如:询问今晚八点是否有两个人的位子,预订在 Sam 名下。"
                onChange={(e) => setPromptLen(e.target.value.length)}
              />
            </Form.Item>
          )}

          <Form.Item label="响铃超时(秒)" style={{ maxWidth: 360 }}>
            <Form.Item name="timeout_sec" noStyle>
              <Select
                options={[15, 30, 60, 120].map((s) => ({ value: s, label: `${s} 秒` }))}
                style={{ width: 120 }}
              />
            </Form.Item>
          </Form.Item>

          <Button type="primary" danger icon={<PhoneOutlined />} htmlType="submit" loading={calling} size="large">
            {calling ? '通话中…' : '拨打电话'}
          </Button>
          <Typography.Text type="secondary" style={{ marginLeft: 12 }}>
            每次外呼都会先播报 AI 身份声明;紧急号码永远不会拨打。
          </Typography.Text>
        </Form>
      </Card>

      {(calling || events.length > 0 || result || error) && (
        <Card title="通话进度" size="small">
          {error && <Alert type="error" showIcon message="呼叫失败" description={error} style={{ marginBottom: 16 }} />}
          {calling && (
            <>
              <Steps
                size="small"
                current={currentStep}
                items={[{ title: '拨号' }, { title: '等待接听' }, { title: '通话中' }, { title: '结束' }]}
                style={{ marginBottom: 16 }}
              />
            </>
          )}
          {events.length > 0 && (
            <Timeline
              items={events.map((e, i) => ({
                key: i,
                color:
                  e.event === 'ended' || e.event === 'busy' || e.event === 'no_answer' || e.event === 'rejected'
                    ? 'red'
                    : e.event === 'answered'
                      ? 'green'
                      : 'blue',
                children: EVENT_TEXT[e.event]?.(e) ?? e.event,
              }))}
            />
          )}
          {result?.transcript && result.transcript.length > 0 && (
            <Card type="inner" title="通话转写" size="small" style={{ marginTop: 8 }}>
              {result.transcript.map((t, i) => (
                <Typography.Paragraph
                  key={i}
                  style={{ marginBottom: 4 }}
                  strong={t.who === 'agent'}
                >
                  <Tag>{t.who === 'agent' ? 'AI' : '对方'}</Tag>
                  {t.text}
                  {t.interrupted && <Typography.Text type="warning"> [被打断]</Typography.Text>}
                </Typography.Paragraph>
              ))}
            </Card>
          )}
          {result && !result.ok && !error && (
            <Alert
              type="warning"
              showIcon
              message={`通话未成功: ${OUTCOME_TEXT[result.outcome ?? ''] ?? result.outcome ?? '未知'}`}
              description={result.detail}
              style={{ marginTop: 8 }}
            />
          )}
        </Card>
      )}
    </Space>
  )
}
