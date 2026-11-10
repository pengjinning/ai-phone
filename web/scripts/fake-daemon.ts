/**
 * A fake ai-phone daemon for developing the web console without a real daemon.
 * Listens on the same control socket path and speaks the NDJSON protocol.
 *
 *   npx tsx scripts/fake-daemon.ts          # binds ~/.ai-phone/control.sock
 *   SOCK=~/ai-phone-test.sock npx tsx scripts/fake-daemon.ts
 *
 * Simulates: status (two lines), an agent-mode call with turns and a transcript,
 * relay say/listen/hangup. Ctrl-C to stop.
 */
import net from 'node:net'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

const SOCK = process.env.SOCK
  ? process.env.SOCK.replace(/^~/, os.homedir())
  : path.join(process.env.AI_PHONE_HOME || path.join(os.homedir(), '.ai-phone'), 'control.sock')

fs.mkdirSync(path.dirname(SOCK), { recursive: true })
if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const now = () => Date.now() / 1000

type FakeCall = {
  id: string
  mode: 'agent' | 'relay'
  to: string
  started: number
  transcript: { who: 'agent' | 'them'; text: string; at: number; interrupted: boolean }[]
  ended: boolean
  connected: boolean
}

let current: FakeCall | null = null
let counter = 0

function result(c: FakeCall) {
  return {
    call_id: c.id,
    mode: c.mode,
    direction: 'out',
    line: 'main',
    remote: c.to,
    outcome: 'completed',
    detail: '',
    ended_by: 'agent',
    created_at: c.started,
    answered_at: c.started + 1,
    ended_at: now(),
    duration_sec: Math.round(now() - c.started - 1),
    transcript: c.transcript,
  }
}

async function handleCall(msg: any, send: (m: any) => void) {
  const id = 'f' + Math.random().toString(16).slice(2, 8)
  const call: FakeCall = { id, mode: msg.relay ? 'relay' : 'agent', to: msg.to, started: now(), transcript: [], ended: false, connected: false }
  current = call
  send({ event: 'created', call_id: id })
  await sleep(600)
  send({ event: 'dialling', uri: `sip:${msg.to}@example.com` })
  await sleep(1200)
  send({ event: 'ringing' })
  await sleep(1500)
  send({ event: 'answered' })
  call.connected = true
  if (call.mode === 'relay') {
    send({ ok: true, event: 'answered', call_id: id, mode: 'relay' })
    return // listen/say take over
  }
  call.transcript.push({ who: 'agent', text: 'Hi, this is an AI assistant calling.', at: now(), interrupted: false })
  const turns = 3
  for (let i = 1; i <= turns; i++) {
    await sleep(2500)
    send({ event: 'turn', turn: i, first_audible_ms: 900 + Math.floor(Math.random() * 600), bargein: i % 2 === 0 })
    call.transcript.push({ who: 'them', text: `This is reply number ${i} from the other side.`, at: now(), interrupted: false })
    await sleep(800)
    call.transcript.push({ who: 'agent', text: `Got it — fake answer ${i}.`, at: now(), interrupted: false })
  }
  call.ended = true
  current = null
  send({ event: 'ended', reason: 'completed', detail: '', exit_code: 0, call_id: id, result: result(call) })
}

async function handleSay(msg: any, send: (m: any) => void) {
  if (!current || current.mode !== 'relay') return send({ ok: false, error: 'no call in progress', code: 11 })
  current.transcript.push({ who: 'agent', text: msg.text, at: now(), interrupted: false })
  await sleep(1200)
  send({ ok: true, result: 'spoken', call_id: current.id })
}

async function handleListen(msg: any, send: (m: any) => void) {
  if (current && current.mode === 'relay' && current.connected) {
    await sleep(2500)
    const text = `Hello, this is fake reply ${++counter}. How can I help?`
    current.transcript.push({ who: 'them', text, at: now(), interrupted: false })
    return send({ ok: true, kind: 'heard', text })
  }
  if (current && current.ended) {
    return send({ ok: true, kind: 'ended', result: result(current) })
  }
  await sleep(Math.min(msg.timeout_sec ?? 60, 10) * 1000)
  send({ ok: true, kind: 'timeout' })
}

async function handleHangup(msg: any, send: (m: any) => void) {
  if (!current) return send({ ok: false, error: 'no call in progress', code: 11 })
  if (msg.say) current.transcript.push({ who: 'agent', text: msg.say, at: now(), interrupted: false })
  await sleep(800)
  current.ended = true
  const r = result(current)
  current = null
  send({ ok: true, result: r })
}

const server = net.createServer((socket) => {
  let buf = ''
  socket.on('data', async (chunk) => {
    buf += chunk.toString()
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line.trim()) continue
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        continue
      }
      const send = (m: any) => socket.writable && socket.write(JSON.stringify(m) + '\n')
      try {
        switch (msg.cmd) {
          case 'status':
            send({
              ok: true,
              lines: {
                main: { id: 'main', kind: 'trunk', address: '+15550100', state: 'registered', registrar: 'sip.example.com', expires_at: now() + 600, last_error: null, since: now() - 300 },
                agent: { id: 'agent', kind: 'sip', address: 'sip:agent@127.0.0.1', state: 'unregistered', registrar: null, expires_at: null, last_error: null, since: now() - 300 },
              },
              active_call: current ? { call_id: 1, call: current.id, mode: current.mode, line_id: 'main', remote: current.to, started_at: current.started, direction: 'out' } : null,
              call: current
                ? { call_id: current.id, mode: current.mode, direction: 'out', line: 'main', remote: current.to, outcome: null, detail: '', ended_by: null, created_at: current.started, answered_at: current.started + 1, ended_at: null, duration_sec: Math.round(now() - current.started) }
                : null,
              relay_listener: false,
            })
            break
          case 'call':
            await handleCall(msg, send)
            break
          case 'listen':
            await handleListen(msg, send)
            break
          case 'say':
            await handleSay(msg, send)
            break
          case 'hangup':
            await handleHangup(msg, send)
            break
          default:
            send({ ok: false, error: `unknown command ${msg.cmd}`, code: 2 })
        }
      } catch (e) {
        send({ ok: false, error: String(e), code: 9 })
      }
    }
  })
})

server.listen(SOCK, () => console.log(`[fake-daemon] listening on ${SOCK}`))
const shutdown = () => {
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 500).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

