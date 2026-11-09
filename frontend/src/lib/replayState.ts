// What the screen shows at a recorded moment (step 38). The live store only knows the CURRENT state ("this request is
// approved"); the recorder remembers WHEN each thing happened, so scrubbing back to before an approval shows the
// request still waiting, before the possible match shows no banner, and before the search closed shows it open.
// Pure functions of the store's values, the replay clock and the recording, so each rule is tested on its own.
import { requestState, type InFlight, type RequestState } from '@/lib/decision'
import type { History } from '@/stream/history'
import type { LogEntry, TaskingRequest } from '@/types'

export interface ReplayClock {
  mode: string
  /** History time (ms since the first frame) of the recorded moment; null when live. */
  t: number | null
}

/** True when the screen is showing a recorded moment and not the live picture. */
export const viewingPast = (r: ReplayClock | null): r is ReplayClock & { t: number } => !!r && r.mode !== 'live' && r.t !== null

/** A request's state at the replay moment: a decision the stream confirmed AFTER that moment has not happened yet. */
export function requestStateAt(
  r: Pick<TaskingRequest, 'id' | 'asset' | 'status'> & { id: string },
  log: readonly LogEntry[],
  inflight: InFlight | undefined,
  replay: ReplayClock | null,
  h: Pick<History, 'decisions'>,
): RequestState {
  const now = requestState(r, log, inflight)
  if (!viewingPast(replay) || (now !== 'approved' && now !== 'rejected')) return now
  const d = h.decisions.get(r.id)
  return d && d.t > replay.t ? 'pending' : now // decided before the moment, or arrived already decided
}

/** Is the possible match (banner and marker) visible at the replay moment? */
export function foundVisibleAt(replay: ReplayClock | null, h: Pick<History, 'foundAt'>): boolean {
  if (!viewingPast(replay)) return true
  const at = h.foundAt
  return at === undefined || at <= replay.t
}

/** Is the search closed at the replay moment? (Live: the log says so.) */
export function closedAt(
  log: readonly LogEntry[],
  replay: ReplayClock | null,
  h: Pick<History, 'logAt'>,
): null | 'located' | 'not_located' {
  if (!log.some((e) => e.action === 'search_closed')) return null
  if (viewingPast(replay)) {
    const at = h.logAt.get('search_closed')
    if (at !== undefined && at > replay.t) return null
  }
  return log.some((e) => e.action === 'found_confirmed') ? 'located' : 'not_located'
}

/** Is the drone feed open at the replay moment? (It follows the panel flag when live.) */
export function feedVisibleAt(open: boolean, replay: ReplayClock | null, h: Pick<History, 'feedOpenedAt'>): boolean {
  if (!open) return false
  if (!viewingPast(replay)) return true
  const at = h.feedOpenedAt
  return at === undefined || at <= replay.t
}
