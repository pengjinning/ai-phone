/**
 * ai-phone web bridge: HTTP + SSE on top of the daemon control socket.
 *
 * Routes:
 *   GET  /api/health           bridge liveness + daemon reachability
 *   GET  /api/status           one-shot status (lines, active call)
 *   GET  /api/events           SSE stream: status snapshots (poll), call events (live)
 *   POST /api/call             dial: phone agent or relay mode; returns terminal result
 *   POST /api/say              speak on a relay call
 *   POST /api/hangup           end a call (optionally with a goodbye)
 *   POST /api/listen           one listen turn (relay)
 *   GET  /api/history          calls placed through this bridge
 *   GET  /api/history/:id      one call, full transcript
 */
import express, { type Request, type Response } from 'express'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DaemonGone, probe, request, socketPath } from './daemon-client.js'
import {
  EXIT_CODES,
  MAX_PROMPT_CHARS,
  MAX_SAY_CHARS,
  type CallEvent,
  type CallHistoryEntry,
  type CallResult,
  type StatusReply,
} from '../shared/types.js'

const PORT = Number(process.env.PORT || 8787)
const SOCK = socketPath()
const STATUS_POLL_MS = Number(process.env.STATUS_POLL_MS || 2000)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(express.json({ limit: '64kb' }))

// ---- outbound call registry (this bridge's own history) --------------------------------------------
const history = new Map<string, CallHistoryEntry>()
const HISTORY_KEEP = 50
const eventFanout = new Set<(evt: { type: string; payload: unknown }) => void>()

function broadcast(type: string, payload: unknown) {
  for (const send of eventFanout) {
    try {
      send({ type, payload })
    } catch {
      // a dead SSE client is removed by its own close handler
    }
  }
}

function remember(entry: CallHistoryEntry) {
  history.set(entry.call_id, entry)
  const ids = [...history.keys()].sort(
    (a, b) => (history.get(b)?.created_at ?? 0) - (history.get(a)?.created_at ?? 0),
  )
  for (const id of ids.slice(HISTORY_KEEP)) history.delete(id)
}

/** Merge a call's terminal result into its history entry (relay calls end via hangup/listen, not the call command). */
function attachResult(callId: string | null | undefined, result: CallResult) {
  const id = result.call_id ?? callId
  const entry = id ? history.get(id) : undefined
  if (entry) {
    entry.result = result
    broadcast('call_event', { event: 'ended', ...result, reason: result.outcome })
  }
}

function daemonDown(res: Response, e: unknown) {
  const message = e instanceof DaemonGone ? e.message : String(e)
  res.status(502).json({ ok: false, error: `ai-phone 守护进程不可达: ${message}`, code: EXIT_CODES.daemon_gone })
}

// ---- health / status -------------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  const alive = await probe(SOCK)
  res.json({ ok: true, daemon: alive ? 'running' : 'not running', socket: SOCK })
})

app.get('/api/status', async (_req, res) => {
  try {
    const reply = (await request(SOCK, { cmd: 'status' })) as unknown as StatusReply | { ok: false }
    if (reply.ok === false) return res.status(500).json(reply)
    res.json(reply)
  } catch (e) {
    daemonDown(res, e)
  }
})

// ---- SSE: status snapshots + live call events -------------------------------------------------------
app.get('/api/events', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  res.write(`retry: 3000\n\n`)

  const push = (evt: { type: string; payload: unknown }) => {
    res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt.payload)}\n\n`)
  }
  eventFanout.add(push)
  const stopStatusPoll = startStatusPoll(push)
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15000)

  const close = () => {
    eventFanout.delete(push)
    stopStatusPoll()
    clearInterval(heartbeat)
  }
  req.on('close', close)
  push({ type: 'hello', payload: { socket: SOCK } })
})

function startStatusPoll(push: (evt: { type: string; payload: unknown }) => void) {
  let timer: NodeJS.Timeout | undefined
  let stopped = false
  const poll = async () => {
    if (stopped) return
    try {
      const reply = (await request(SOCK, { cmd: 'status' }, { timeoutMs: 2500 })) as unknown as StatusReply
      push({ type: 'status', payload: reply })
    } catch {
      push({ type: 'status', payload: { ok: false, error: 'daemon unreachable', daemon: false } })
    }
  }
  void poll()
  timer = setInterval(poll, STATUS_POLL_MS)
  return () => {
    stopped = true
    if (timer) clearInterval(timer)
  }
}

// ---- call --------------------------------------------------------------------------------------------
function validateCall(body: any): string | null {
  if (typeof body?.to !== 'string' || !body.to.trim()) return "需要非空的 'to' (E.164 号码或 sip: URI)"
  if (body.timeout_sec != null && !(typeof body.timeout_sec === 'number' && body.timeout_sec > 0 && body.timeout_sec <= 3600))
    return "'timeout_sec' 必须在 0 到 3600 之间"
  if (body.line != null && typeof body.line !== 'string') return "'line' 必须是字符串"
  const prompt = body.prompt
  if (prompt != null && (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS))
    return `'prompt' 不能超过 ${MAX_PROMPT_CHARS} 字符`
  if (body.relay && prompt) return 'relay 模式下 prompt 无效'
  return null
}

app.post('/api/call', async (req, res) => {
  const problem = validateCall(req.body)
  if (problem) return res.status(400).json({ ok: false, error: problem, code: EXIT_CODES.usage })
  const { to, line = null, prompt = null, relay = false, timeout_sec = 30 } = req.body

  const events: CallEvent[] = []
  let callId: string | null = null
  const onEvent = (m: Record<string, unknown>) => {
    if ('event' in m) {
      const evt = m as unknown as CallEvent
      events.push(evt)
      if (evt.event === 'created') callId = evt.call_id
      broadcast('call_event', evt)
    }
  }

  try {
    const terminal = await request(SOCK, { cmd: 'call', to, line, prompt, relay, timeout_sec: Number(timeout_sec) }, {
      onEvent,
      timeoutMs: 3600_000 + 60_000,
    })
    // terminal: {ok:true,event:'answered'} for relay, or {event:'ended', result} for agent mode
    const answered = (terminal as any).event === 'answered'
    const result = ((terminal as any).result ?? null) as CallHistoryEntry['result']
    const exitCode = Number((terminal as any).exit_code ?? EXIT_CODES.rejected)
    if (callId) {
      remember({
        call_id: callId,
        to,
        line,
        mode: relay ? 'relay' : 'agent',
        prompt,
        created_at: Date.now() / 1000,
        events,
        result,
        error: null,
      })
    }    if (answered) {
      res.json({ ok: true, call_id: callId, mode: 'relay', outcome: 'answered' })
    } else {
      res.json({ ok: exitCode === 0, ...(result ?? {}), exit_code: exitCode, events })
    }
  } catch (e) {
    const message = e instanceof DaemonGone ? e.message : String(e)
    if (callId) {
      remember({
        call_id: callId,
        to,
        line,
        mode: relay ? 'relay' : 'agent',
        prompt,
        created_at: Date.now() / 1000,
        events,
        result: null,
        error: message,
      })
    }
    daemonDown(res, e)
  }
})

// ---- say / hangup / listen -----------------------------------------------------------------------------
app.post('/api/say', async (req, res) => {
  const text = req.body?.text
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_SAY_CHARS)
    return res.status(400).json({ ok: false, error: `需要 1 到 ${MAX_SAY_CHARS} 字符的 'text'`, code: EXIT_CODES.usage })
  try {
    const reply = await request(SOCK, {
      cmd: 'say',
      text,
      call_id: req.body?.call_id ?? undefined,
    })
    res.json(reply)
  } catch (e) {
    daemonDown(res, e)
  }
})

app.post('/api/hangup', async (req, res) => {
  try {
    const reply = await request(
      SOCK,
      { cmd: 'hangup', call_id: req.body?.call_id ?? undefined, say: req.body?.say ?? undefined },
      { timeoutMs: 90_000 },
    )
    res.json(reply)
    const result = (reply as any).result as CallResult | undefined
    if (result?.call_id) attachResult(result.call_id, result)
  } catch (e) {
    daemonDown(res, e)
  }
})

app.post('/api/listen', async (req, res) => {
  const timeout = Number(req.body?.timeout_sec ?? 60)
  if (!(timeout > 0 && timeout <= 3600))
    return res.status(400).json({ ok: false, error: "'timeout_sec' 必须在 0 到 3600 之间", code: EXIT_CODES.usage })
  try {
    const reply = await request(
      SOCK,
      { cmd: 'listen', call_id: req.body?.call_id ?? undefined, timeout_sec: timeout },
      { timeoutMs: (timeout + 15) * 1000 },
    )
    res.json(reply)
    if ((reply as any).kind === 'ended' && (reply as any).result?.call_id)
      attachResult((reply as any).result.call_id, (reply as any).result)
  } catch (e) {
    daemonDown(res, e)
  }
})

// ---- history --------------------------------------------------------------------------------------------
app.get('/api/history', (_req, res) => {
  const entries = [...history.values()].sort((a, b) => b.created_at - a.created_at)
  res.json(
    entries.map((e) => ({
      call_id: e.call_id,
      to: e.to,
      line: e.line,
      mode: e.mode,
      prompt: e.prompt,
      created_at: e.created_at,
      outcome: e.result?.outcome ?? null,
      ended_by: e.result?.ended_by ?? null,
      duration_sec: e.result?.duration_sec ?? null,
      turns: e.result?.transcript.length ?? 0,
      error: e.error,
    })),
  )
})

app.get('/api/history/:id', (req, res) => {
  const entry = history.get(req.params.id)
  if (!entry) return res.status(404).json({ ok: false, error: 'no such call' })
  res.json(entry)
})

// ---- static frontend (production) -------------------------------------------------------------------------
const distDir = path.resolve(__dirname, '../dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const server = http.createServer(app)
server.headersTimeout = 0
server.requestTimeout = 0
server.keepAliveTimeout = 0
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ai-phone-web] bridge listening on http://127.0.0.1:${PORT} (socket: ${SOCK})`)
  probe(SOCK).then((alive) =>
    console.log(`[ai-phone-web] ai-phone daemon: ${alive ? 'running' : 'not running (start it with `ai-phone run`)'}`),
  )
})
