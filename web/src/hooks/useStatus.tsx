import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { CallEvent, StatusReply } from '../../shared/types'

interface StatusState {
  /** Latest daemon status snapshot; null when the daemon is unreachable. */
  status: StatusReply | null
  daemonAlive: boolean | null
  /** Live call events from the SSE stream (most recent last). */
  events: CallEvent[]
  /** History revision: bump to make pages refetch. */
  historyRev: number
  refreshHistory: () => void
}

const StatusContext = createContext<StatusState | null>(null)

export function StatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StatusReply | null>(null)
  const [daemonAlive, setDaemonAlive] = useState<boolean | null>(null)
  const [events, setEvents] = useState<CallEvent[]>([])
  const [historyRev, setHistoryRev] = useState(0)
  const esRef = useRef<EventSource | null>(null)

  const refreshHistory = useCallback(() => setHistoryRev((r) => r + 1), [])

  useEffect(() => {
    const es = new EventSource('/api/events')
    esRef.current = es

    es.addEventListener('status', (e) => {
      const payload = JSON.parse((e as MessageEvent).data) as
        | StatusReply
        | { ok: false; error: string; daemon: false }
      if ('daemon' in payload && payload.daemon === false) {
        setDaemonAlive(false)
        setStatus(null)
      } else {
        setDaemonAlive(true)
        setStatus(payload as StatusReply)
      }
    })

    es.addEventListener('call_event', (e) => {
      const evt = JSON.parse((e as MessageEvent).data) as CallEvent
      setEvents((prev) => [...prev, evt])
      if (evt.event === 'ended') setHistoryRev((r) => r + 1)
    })

    es.onerror = () => setDaemonAlive(null)

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  // a fresh `say` result means the transcript moved; relay console refetches on its own
  const value = useMemo(
    () => ({ status, daemonAlive, events, historyRev, refreshHistory }),
    [status, daemonAlive, events, historyRev, refreshHistory],
  )
  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>
}

export function useStatus(): StatusState {
  const ctx = useContext(StatusContext)
  if (!ctx) throw new Error('useStatus must be used within StatusProvider')
  return ctx
}
