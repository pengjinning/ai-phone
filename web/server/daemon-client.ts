/**
 * Client for the ai-phone daemon control socket (NDJSON over AF_UNIX).
 * Mirrors src/ai_phone/control/client.py: send one request, stream events, return the terminal reply.
 */
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export class DaemonGone extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DaemonGone'
  }
}

/**
 * Resolve the control socket path the same way paths.socket_path() does.
 * Falls back to a hashed path under /tmp when ~/.ai-phone is too deep.
 */
export function socketPath(): string {
  const home = process.env.AI_PHONE_HOME || path.join(os.homedir(), '.ai-phone')
  const candidate = path.join(home, 'control.sock')
  if (Buffer.byteLength(candidate) <= 100) return candidate
  const digest = crypto.createHash('sha256').update(home).digest('hex').slice(0, 12)
  const base = fs.existsSync('/private/tmp') ? '/private/tmp' : '/tmp'
  return path.join(base, `ai-phone-${process.getuid?.() ?? 0}`, `${digest}.sock`)
}

export interface RequestOptions {
  onEvent?: (msg: Record<string, unknown>) => void
  timeoutMs?: number
  /** Called with the live socket so a caller can abort the wait. */
  socketHolder?: { socket?: net.Socket }
  /** AbortSignal: on abort the socket is destroyed (the daemon cancels the listen). */
  signal?: AbortSignal
}

/**
 * Send one command; stream `event` messages to onEvent; resolve with the terminal
 * message (`ended`, or any reply carrying `ok`). Rejects with DaemonGone otherwise.
 */
export function request(
  socketPath: string,
  msg: Record<string, unknown>,
  opts: RequestOptions = {},
): Promise<Record<string, unknown>> {
  const { onEvent, timeoutMs, socketHolder, signal } = opts
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    socket.setNoDelay(true)
    if (socketHolder) socketHolder.socket = socket
    let settled = false
    let buffer = ''

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (socketHolder) delete socketHolder.socket
      socket.destroy()
      fn()
    }
    const timer =
      timeoutMs != null
        ? setTimeout(() => finish(() => reject(new DaemonGone(`timeout after ${timeoutMs} ms`))), timeoutMs)
        : undefined

    const onAbort = () => finish(() => reject(new DaemonGone('aborted')))
    signal?.addEventListener('abort', onAbort, { once: true })

    socket.on('connect', () => {
      socket.write(JSON.stringify(msg) + '\n')
    })
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let idx: number
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        if (!line.trim()) continue
        let m: Record<string, unknown>
        try {
          m = JSON.parse(line)
        } catch {
          continue // a line that is not JSON must not kill the stream
        }
        if ('event' in m && onEvent) onEvent(m)
        if (m.event === 'ended' || 'ok' in m) finish(() => resolve(m))
      }
    })
    socket.on('error', (err: NodeJS.ErrnoException) =>
      finish(() => reject(new DaemonGone(`daemon connection failed: ${err.message}`))),
    )
    socket.on('close', () => finish(() => reject(new DaemonGone('the daemon closed the connection'))))
  })
}

/** True when something is listening on the control socket. Resolves within ~1.5 s. */
export function probe(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath)
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(1500, () => done(false))
    socket.on('connect', () => done(true))
    socket.on('error', () => done(false))
  })
}
