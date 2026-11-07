// The ONE stream client. It lives outside React on purpose.
//
// The server cancels the fake case when its last socket disconnects and restarts it from zero on
// the next connect. React StrictMode mounts effects twice in dev, so a socket opened inside a
// component would connect -> disconnect -> reconnect and replay every scripted beat with new
// ids. Here there is exactly one session at a time and components never touch the socket.
//
// Flow (roadmap step 8):
//   openCase(profile) -> POST /case -> GET /report (hydrate) -> WS /stream/{id} -> route by type.
// Every (re)connect re-hydrates from /report first, because the stream has no history.
import { API_URL, WS_URL } from '@/lib/config'
import { resetGhosts, noteEvidence, pushFrame, readRespawned } from './ghostBuffer'
import { history } from './history'
import { useStore } from '@/store'
import type { Report, StreamMessage, SubjectProfile } from '@/types'

const BACKOFF_BASE_MS = 500
const BACKOFF_MAX_MS = 5000
const NOT_FOUND_CLOSE_CODE = 4404

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface Session {
  /** Bumped per session so late callbacks from a replaced session are ignored. */
  id: number
  caseId: string | null
  /**
   * Present when we created the case (openCase). If the server later forgets the case (API
   * restart wipes memory), we can recreate it. Absent for attachCase, which can only connect.
   */
  profile: SubjectProfile | null
  created: boolean
  ws: WebSocket | null
  attempt: number
  everConnected: boolean
  timer: ReturnType<typeof setTimeout> | null
  closed: boolean
}

let session: Session | null = null
let nextId = 1

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init)
  if (!res.ok) throw new HttpError(res.status, `${init?.method ?? 'GET'} ${path} -> ${res.status}`)
  return (await res.json()) as T
}

const store = () => useStore.getState()

function stop(s: Session | null): void {
  if (!s) return
  s.closed = true
  if (s.timer) clearTimeout(s.timer)
  if (s.ws) {
    const ws = s.ws
    s.ws = null
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null
    ws.close()
  }
}

/** Create a case on the server and stream it. Replaces any current session. */
export function openCase(profile: SubjectProfile): void {
  begin({ caseId: profile.case_id ?? null, profile })
}

/** Stream an existing case id without creating it (e.g. a shared link). Unknown id -> "Case not found". */
export function attachCase(caseId: string): void {
  begin({ caseId, profile: null })
}

/** Drop the session and clear the screen. */
export function closeCase(): void {
  stop(session)
  session = null
  resetGhosts()
  store().resetCaseData()
  store().setCaseProfile(null)
  store().setConnection('idle')
  store().setPanel('newCase', true)
}

function begin(init: { caseId: string | null; profile: SubjectProfile | null }): void {
  stop(session)
  resetGhosts()
  store().resetCaseData()
  store().setCaseProfile(init.profile)
  const s: Session = {
    id: nextId++,
    caseId: init.caseId,
    profile: init.profile,
    created: false,
    ws: null,
    attempt: 0,
    everConnected: false,
    timer: null,
    closed: false,
  }
  session = s
  void connect(s)
}

async function connect(s: Session): Promise<void> {
  if (s.closed) return
  store().setConnection(s.everConnected ? 'reconnecting' : 'connecting', s.attempt)
  try {
    if (s.profile && !s.created) {
      const created = await http<SubjectProfile>('/case', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s.profile),
      })
      if (s.closed) return
      s.created = true
      s.caseId = created.case_id ?? s.caseId
      s.profile = created // keeps the same case_id, so a later recreate reuses it
      store().setCaseProfile(created)
    }
    if (!s.caseId) throw new Error('No case id')
    const report = await http<Report>(`/report/${s.caseId}`)
    if (s.closed) return
    store().hydrate(report)
  } catch (e) {
    if (s.closed) return
    if (e instanceof HttpError && e.status === 404) return serverLostCase(s)
    return scheduleRetry(s)
  }
  openSocket(s)
}

function openSocket(s: Session): void {
  const ws = new WebSocket(`${WS_URL}/stream/${s.caseId}`)
  s.ws = ws
  ws.onopen = () => {
    if (s.closed || s.ws !== ws) return
    s.attempt = 0
    s.everConnected = true
    store().setConnection('live')
  }
  ws.onmessage = (ev) => {
    if (s.closed || s.ws !== ws) return
    let msg: StreamMessage
    try {
      msg = JSON.parse(ev.data as string) as StreamMessage
    } catch {
      console.warn('Ignoring unparseable stream message')
      return
    }
    route(msg)
  }
  ws.onclose = (ev) => {
    if (s.closed || s.ws !== ws) return
    s.ws = null
    if (ev.code === NOT_FOUND_CLOSE_CODE) return serverLostCase(s)
    scheduleRetry(s)
  }
  // onerror is always followed by onclose, which owns the retry.
}

function route(msg: StreamMessage): void {
  switch (msg.type) {
    case 'ghosts': {
      // Positions go to typed arrays (no React); only small metadata goes to the store.
      pushFrame(msg.data.positions, msg.data.t, readRespawned(msg.data))
      store().applyGhostMeta(msg.data.t, msg.data.alive_fraction, msg.data.clusters ?? [])
      return
    }
    case 'evidence':
      noteEvidence()
      history.noteEvent(performance.now(), 'evidence', msg.data.id) // a tick on the time bar
      store().applyMessage(msg)
      return
    case 'tasking':
      history.noteEvent(performance.now(), 'tasking', msg.data.id)
      store().applyMessage(msg)
      return
    case 'found':
      history.noteEvent(performance.now(), 'found')
      store().applyMessage(msg)
      return
    case 'log':
      store().applyMessage(msg)
      return
    default: {
      const unreachable: never = msg
      return unreachable
    }
  }
}

/** The server doesn't know this case. Unknown id: stop. Server restarted and we own the case: recreate it. */
function serverLostCase(s: Session): void {
  if (s.profile && s.everConnected) {
    // API restarted: its memory is gone, and the fake case replays from zero with new ids.
    // The screen must match the backend, so clear what we had and rebuild.
    s.created = false
    s.everConnected = false
    resetGhosts()
    store().resetCaseData()
    void connect(s)
    return
  }
  store().setConnection('not_found')
}

function scheduleRetry(s: Session): void {
  if (s.closed) return
  s.attempt += 1
  store().setConnection('reconnecting', s.attempt)
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** (s.attempt - 1), BACKOFF_MAX_MS)
  s.timer = setTimeout(() => void connect(s), delay)
}

/** Test/debug hook: how many sockets this module currently holds (must never exceed 1). */
export function openSocketCount(): number {
  return session?.ws ? 1 : 0
}

// Vite HMR re-evaluates this module; close the old socket so dev never leaks a second one.
if (import.meta.hot) {
  import.meta.hot.dispose(() => stop(session))
}
