/** Thin fetch helpers for the bridge API. */
import type { CallHistoryEntry, CallResult, ListenReply, StatusReply } from '../../shared/types'

export class ApiError extends Error {
  code: number
  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({ ok: false, error: res.statusText, code: 0 }))
  if (!res.ok || (body as any).ok === false) {
    throw new ApiError((body as any).error || `HTTP ${res.status}`, (body as any).code ?? 0)
  }
  return body as T
}

export interface CallRequestBody {
  to: string
  line?: string | null
  prompt?: string | null
  relay?: boolean
  timeout_sec?: number
}

export interface CallResponse {
  ok: boolean
  call_id?: string
  mode?: string
  outcome?: string
  detail?: string
  exit_code?: number
  transcript?: CallResult['transcript']
}

export interface HistoryListItem {
  call_id: string
  to: string
  line: string | null
  mode: 'agent' | 'relay'
  prompt: string | null
  created_at: number
  outcome: string | null
  ended_by: string | null
  duration_sec: number | null
  turns: number
  error: string | null
}

export const api = {
  health: () => fetch('/api/health').then((r) => r.json()) as Promise<{ ok: boolean; daemon: string; socket: string }>,
  status: () => fetch('/api/status').then((r) => json<StatusReply>(r)),
  call: (body: CallRequestBody) =>
    fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => json<CallResponse>(r)),
  say: (text: string, callId?: string) =>
    fetch('/api/say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, call_id: callId }),
    }).then((r) => json<{ ok: true; result: string; call_id: string }>(r)),
  hangup: (callId?: string, say?: string) =>
    fetch('/api/hangup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_id: callId, say }),
    }).then((r) => json<{ ok: true; result: CallResult }>(r)),
  listen: (timeoutSec = 60, callId?: string) =>
    fetch('/api/listen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeout_sec: timeoutSec, call_id: callId }),
    }).then((r) => json<ListenReply>(r)),
  history: () => fetch('/api/history').then((r) => r.json()) as Promise<HistoryListItem[]>,
  historyEntry: (id: string) => fetch(`/api/history/${id}`).then((r) => r.json()) as Promise<CallHistoryEntry>,
}
