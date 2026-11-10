import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Input,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import {
  AudioOutlined,
  PhoneOutlined,
  SendOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { CallResult, TranscriptLine } from '../../shared/types'
import { api, ApiError } from '../api/client'
import { useStatus } from '../hooks/useStatus'

interface Turn extends TranscriptLine {
  /** local echo of what we sent, shown until the daemon confirms via listen result */
  pending?: boolean
}

export default function RelayConsole() {
  const { message } = AntApp.useApp()
  const { status } = useStatus()
  const [turns, setTurns] = useState<Turn[]>([])
  const [listening, setListening] = useState(false)
  const [saying, setSaying] = useState(false)
  const [callId, setCallId] = useState<string | null>(null)
  const [callInfo, setCallInfo] = useState<CallResult | null>(null)
  const [callEnded, setCallEnded] = useState<CallResult | null>(null)
  const [text, setText] = useState('')
  const [goodbye, setGoodbye] = useState('')
  const listenAbort = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const activeRelay = status?.call && !status.call.ended_at && status.call.mode === 'relay' ? status.call : null

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns])

  // adopt the current relay call when the console opens or a new relay call appears
  useEffect(() => {
    if (activeRelay?.call_id && activeRelay.call_id !== callId && !callEnded) {
      setCallId(activeRelay.call_id!)
      setTurns([])
      setCallInfo(null)
    }
  }, [activeRelay?.call_id, callId, callEnded])

  const appendHeard = useCallback((t: string) => {
    setTurns((prev) => [...prev, { who: 'them', text: t, at: Date.now() / 1000, interrupted: false }])
  }, [])

  const doListen = useCallback(
    async (timeout = 120) => {
      if (listening) return
      setListening(true)
      try {
        const reply = await api.listen(timeout, callId ?? undefined)
        if (!reply.ok) {
          if (reply.code === 12) message.warning('另一个监听者已在等待')
          else message.error(reply.error)
        } else if (reply.kind === 'heard') {
          appendHeard(reply.text)
        } else if (reply.kind === 'incoming') {
          setCallId(reply.call_id)
          setTurns([{ who: 'agent', text: '(来电已接听)', at: Date.now() / 1000, interrupted: false }])
          message.info(`来电 ${reply.call_id}: ${reply.remote}`)
        } else if (reply.kind === 'ended') {
          setCallEnded(reply.result)
          setTurns(reply.result.transcript)
        } else {
          // timeout: fine, the operator can listen again
        }
      } catch (e) {
        message.error(e instanceof ApiError ? e.message : String(e))
      } finally {
        setListening(false)
      }
    },
    [appendHeard, callId, listening, message],
  )

  const doSay = useCallback(
    async (value: string) => {
      const t = value.trim()
      if (!t) return
      setSaying(true)
      const line: Turn = { who: 'agent', text: t, at: Date.now() / 1000, interrupted: false }
      setTurns((prev) => [...prev, line])
      try {
        await api.say(t, callId ?? undefined)
        setText('')
      } catch (e) {
        message.error(e instanceof ApiError ? e.message : String(e))
        setTurns((prev) => prev.filter((x) => x !== line)) // roll back the optimistic line
      } finally {
        setSaying(false)
      }
    },
    [callId, message],
  )

  const doHangup = useCallback(
    async (say?: string) => {
      try {
        const reply = await api.hangup(callId ?? undefined, say?.trim() || undefined)
        if (reply.result) {
          setCallEnded(reply.result)
          setTurns(reply.result.transcript)
        }
      } catch (e) {
        message.error(e instanceof ApiError ? e.message : String(e))
      }
    },
    [callId, message],
  )

  const reset = () => {
    setTurns([])
    setCallEnded(null)
    setCallId(null)
    setCallInfo(null)
  }

  const connected = activeRelay?.call_id === callId && !callEnded

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card
        size="small"
        title={
          <Space>
            中继控制台
            {callEnded ? (
              <Tag color="default">已结束</Tag>
            ) : connected ? (
              <Tag color="processing">通话中 · {activeRelay?.remote}</Tag>
            ) : (
              <Tag color="default">空闲</Tag>
            )}
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={reset} size="small">
              重置
            </Button>
          </Space>
        }
      >
        {callEnded ? (
          <Alert
            type={callEnded.outcome === 'completed' ? 'success' : 'warning'}
            showIcon
            message={`通话 ${callEnded.call_id} 已结束: ${callEnded.outcome ?? ''}${callEnded.detail ? ` — ${callEnded.detail}` : ''}`}
            description={`时长 ${callEnded.duration_sec ?? 0} s · ${callEnded.transcript.length} 条转写`}
            style={{ marginBottom: 16 }}
          />
        ) : !connected ? (
          <Alert
            type="info"
            showIcon
            message="没有进行中的中继通话"
            description="从「拨打电话」页发起中继模式通话,或点击下方「等待来电」接听来电。ai-phone 会先向对方打招呼并等待你说话。"
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <div
          style={{
            height: 360,
            overflowY: 'auto',
            border: '1px solid #f0f0f0',
            borderRadius: 8,
            padding: 12,
            background: '#fafafa',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {turns.length === 0 && (
            <Typography.Text type="secondary" style={{ textAlign: 'center', marginTop: 120 }}>
              {connected ? '点击「听对方说」开始对话' : '暂无对话'}
            </Typography.Text>
          )}
          {turns.map((t, i) => (
            <div key={i} style={{ alignSelf: t.who === 'agent' ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: t.who === 'agent' ? '#2f54eb' : '#fff',
                  color: t.who === 'agent' ? '#fff' : '#333',
                  border: t.who === 'agent' ? 'none' : '1px solid #e8e8e8',
                  fontSize: 14,
                  whiteSpace: 'pre-wrap',
                }}
              >
                {t.text}
                {t.interrupted && <span style={{ opacity: 0.7 }}> (被打断)</span>}
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 11, alignSelf: t.who === 'agent' ? 'flex-end' : undefined }}>
                {t.who === 'agent' ? 'AI (你)' : '对方'} · {dayjs(t.at * 1000).format('HH:mm:ss')}
              </Typography.Text>
            </div>
          ))}
          {listening && (
            <div style={{ alignSelf: 'flex-start' }}>
              <Spin size="small" /> <Typography.Text type="secondary">正在听对方说话…</Typography.Text>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <Space.Compact style={{ width: '100%', marginTop: 12 }}>
          <Input
            placeholder={connected ? '输入要说的话 (最多 2000 字符)' : '没有进行中的通话'}
            value={text}
            disabled={!connected || saying}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={() => doSay(text)}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={!connected || saying || !text.trim()}
            loading={saying}
            onClick={() => doSay(text)}
          >
            说
          </Button>
        </Space.Compact>

        <Space style={{ marginTop: 12 }} wrap>
          <Button
            icon={<AudioOutlined />}
            onClick={() => doListen(120)}
            loading={listening}
            disabled={!!callEnded || saying || (!connected && !callId)}
          >
            听对方说
          </Button>
          <Button
            danger
            icon={<PhoneOutlined />}
            disabled={!!callEnded || !callId}
            onClick={() => doHangup()}
          >
            挂断
          </Button>
          <Input
            placeholder="告别语(可选,随挂断一起说)"
            value={goodbye}
            onChange={(e) => setGoodbye(e.target.value)}
            style={{ width: 260 }}
            disabled={!!callEnded || !callId}
            onPressEnter={() => doHangup(goodbye)}
          />
          <Button disabled={!!callEnded || !callId} onClick={() => doHangup(goodbye)}>
            说完挂断
          </Button>
        </Space>

        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          提示: 对方等待回复超过 25 秒,ai-phone 会致歉并挂断。思考时它会先说「请稍等」。
          {!connected && !callEnded && ' 也可以在空闲时点击「听对方说」等待来电。'}
        </Typography.Paragraph>
      </Card>
    </Space>
  )
}
