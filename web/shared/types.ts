/**
 * Mirror of the ai-phone daemon control protocol (src/ai_phone/control/protocol.py + calls.py).
 * LineStatus mirrors telephony/state.py.
 */

export type LineKind = 'trunk' | 'sip'
export type LineState = 'unregistered' | 'registering' | 'registered' | 'degraded' | 'skipped'

export interface LineStatus {
  id: string
  kind: LineKind
  address: string
  state: LineState
  registrar: string | null
  expires_at: number | null
  last_error: string | null
  since: number
}

export interface ActiveCall {
  call_id?: number
  call?: string
  mode?: string
  line_id?: string
  remote?: string
  started_at?: number
  direction?: string
}

export interface TranscriptLine {
  who: 'agent' | 'them'
  text: string
  at: number
  interrupted: boolean
}

export type CallOutcome =
  | 'completed'
  | 'busy'
  | 'no_answer'
  | 'rejected'
  | 'redirected'
  | 'cancelled'
  | 'answered'

export type EndedBy =
  | 'agent'
  | 'them'
  | 'timeout'
  | 'silence'
  | 'max_duration'
  | 'error'
  | 'hangup_command'

export interface CallResult {
  call_id: string
  mode: 'agent' | 'relay'
  direction: 'in' | 'out'
  line: string
  remote: string
  outcome: CallOutcome | null
  detail: string
  ended_by: EndedBy | null
  created_at: number
  answered_at: number | null
  ended_at: number | null
  duration_sec: number | null
  transcript: TranscriptLine[]
}

/** `call` summary without transcript (from the status command). */
export type CallSummary = Omit<CallResult, 'transcript'>

export interface StatusReply {
  ok: true
  lines: Record<string, LineStatus>
  active_call: ActiveCall | null
  call: CallSummary | null
  relay_listener: boolean
}

/** Daemon error reply: ok:false + error text + numeric exit code. */
export interface DaemonError {
  ok: false
  error: string
  code: number
}

export const EXIT_CODES = {
  answered: 0,
  completed: 0,
  usage: 2,
  busy: 5,
  line_busy: 5,
  no_answer: 6,
  rejected: 7,
  redirected: 8,
  daemon_gone: 9,
  listen_timeout: 10,
  no_call: 11,
  listener_busy: 12,
  blocked: 13,
  daily_limit: 14,
} as const

export const MAX_PROMPT_CHARS = 4000
export const MAX_SAY_CHARS = 2000

/** Progress events streamed by the daemon while a `call` command runs. */
export type CallEvent =
  | { event: 'created'; call_id: string }
  | { event: 'dialling'; code?: number; uri?: string }
  | { event: 'ringing' | 'answered' | 'busy' | 'no_answer' | 'rejected' | 'redirected'; code?: number; reason?: string }
  | { event: 'turn'; turn: number; first_audible_ms: number; bargein: boolean }
  | { event: 'ended'; reason: string; detail: string; exit_code: number; call_id: string; result: CallResult }

export interface CallOptions {
  to: string
  line?: string | null
  prompt?: string | null
  relay?: boolean
  timeout_sec?: number
}

/** What the bridge remembers about a call it placed. */
export interface CallHistoryEntry {
  call_id: string
  to: string
  line: string | null
  mode: 'agent' | 'relay'
  prompt: string | null
  created_at: number
  events: CallEvent[]
  /** Set once the terminal `ended` event arrives; carries the transcript. */
  result: CallResult | null
  /** Set when the call never connected (daemon refused, dial error…). */
  error: string | null
}

/** A `listen` reply from the daemon: heard speech, an incoming call, a call end, or a timeout. */
export type ListenReply =
  | { ok: true; kind: 'heard'; text: string }
  | { ok: true; kind: 'incoming'; call_id: string; line: string; remote: string }
  | { ok: true; kind: 'ended'; result: CallResult }
  | { ok: true; kind: 'timeout' }
  | { ok: false; error: string; code: number }
