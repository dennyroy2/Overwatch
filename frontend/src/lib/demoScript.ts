// Tips that arrive during the demo case. Hard rule 3 holds: this only POSTs evidence to the server, exactly
// as the tip box does, and the cards, pins and time-bar ticks appear when the stream brings them back.
//
// The built-in server sends its own tips (family, bus driver, ground team, drone) unless it was started with
// OVERWATCH_FAKE_BEATS=0 (`make api-live`), which is how the scripted scenario is run. In that mode nothing
// would arrive on its own, so after a short wait with no evidence this plays the same story as
// `scenario/margaret.json`. If the server's own tips do arrive, this does nothing, so nothing is doubled; and its last
// beat, the drone clue, is skipped when a drone clue (perception's `emit`) is already there.
import { API_URL } from '@/lib/config'
import { DEMO_PLACES } from '@/lib/geo'
import type { Evidence } from '@/types'

/** How long to wait for the server's own first tip (it sends one at about 6 s) before taking over. */
export const QUIET_AFTER_MS = 9000

type DemoTip = Pick<Evidence, 'kind' | 'source' | 'reliability' | 'location' | 'radius_m' | 'summary' | 'raw_text'> &
  Partial<Pick<Evidence, 'detection_prob'>> & {
    /** Seconds after the decision to take over. */
    afterS: number
    /** The story time of the tip, in minutes after she was last seen. */
    minutesAfter: number
  }

/** The same five beats as `scenario/margaret.json` (grey hooded jacket), at the scenario's own times (2, 8, 34, 40 and 48 s; Akshat's ask #8) and story minutes. */
export const DEMO_TIPS: readonly DemoTip[] = [
  { afterS: 2, minutesAfter: 0, kind: 'last_seen', source: 'family', reliability: 0.95,
    location: DEMO_PLACES.lastSeen, radius_m: 50,
    summary: 'Daughter: last saw Margaret at 124 St & Jasper Ave around 2 PM',
    raw_text: 'My mom left her apartment on 124 Street around two. She was wearing her grey hooded jacket.' },
  { afterS: 8, minutesAfter: 0, kind: 'favourite_place', source: 'family', reliability: 0.8,
    location: DEMO_PLACES.railtownPark, radius_m: 150,
    summary: 'Family: she walks in Railtown Park (110 St & 104 Ave) most afternoons',
    raw_text: 'She loves Railtown Park, she walks there almost every afternoon.' },
  { afterS: 34, minutesAfter: 85, kind: 'searched_area', source: 'ground_team', reliability: 0.9, detection_prob: 0.7,
    location: DEMO_PLACES.railtownPark, radius_m: 300,
    summary: 'Ground Team 1 searched 300 m around Railtown Park. Nothing found.',
    raw_text: 'Team 1 cleared the blocks around Railtown Park, no sign of her.' },
  { afterS: 40, minutesAfter: 35, kind: 'sighting', source: 'transit', reliability: 0.75,
    location: DEMO_PLACES.busStop, radius_m: 100,
    summary: 'Bus driver: woman in a grey hooded jacket got off at Groat Rd & Emily Murphy Park Rd',
    raw_text: "I'm a bus driver. An older lady in a grey hoodie got off at the Emily Murphy Park stop on Groat Road, maybe 2:35." },
  { afterS: 48, minutesAfter: 120, kind: 'clue', source: 'drone_ai', reliability: 0.82,
    location: DEMO_PLACES.droneSpot, radius_m: 50,
    summary: 'Drone 2: possible person in grey hooded jacket lying on the grassy bank by the water, Emily Murphy Park (82%)',
    raw_text: null },
]

/** The evidence to POST for one tip. Story time = when she was last seen + the tip's minutes. */
export function buildDemoEvidence(caseId: string, tip: DemoTip, lastSeenMs: number): Partial<Evidence> {
  const { afterS: _a, minutesAfter, ...rest } = tip
  return { ...rest, case_id: caseId, confirmed: true, time: new Date(lastSeenMs + minutesAfter * 60_000).toISOString() }
}

export interface DemoDeps {
  caseId: () => string | null
  evidenceCount: () => number
  lastSeenMs: () => number
  /** True once a drone clue is on the screen (perception's `emit`, or a person's), so this does not post a second one. */
  hasDroneEvidence?: () => boolean
  post: (ev: Partial<Evidence>) => Promise<void>
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (h: unknown) => void
  onError?: (message: string) => void
}

/**
 * Wait QUIET_AFTER_MS; if no evidence has arrived by then the server is not sending its own, so post the tips on
 * their schedule. Returns a function that cancels everything still waiting (a new case, or closing this one).
 */
export function startDemoTips(deps: DemoDeps): () => void {
  const timers: unknown[] = []
  let cancelled = false

  timers.push(deps.setTimer(() => {
    // The server only gives the case its id a moment after it opens, so it is read now, not at the start.
    const caseId = deps.caseId()
    if (cancelled || caseId === null || deps.evidenceCount() > 0) return
    for (const tip of DEMO_TIPS) {
      timers.push(deps.setTimer(() => {
        if (cancelled || deps.caseId() !== caseId) return    // closed, or another case was opened
        // One drone clue only: if perception (or a person) has already delivered one, this beat would count it twice.
        if (tip.source === 'drone_ai' && deps.hasDroneEvidence?.()) return
        deps.post(buildDemoEvidence(caseId, tip, deps.lastSeenMs())).catch(() => {
          deps.onError?.('Could not send a demo tip. Is the API running?')
        })
      }, tip.afterS * 1000))
    }
  }, QUIET_AFTER_MS))

  return () => {
    cancelled = true
    timers.forEach((t) => deps.clearTimer(t))
  }
}

export async function postEvidence(ev: Partial<Evidence>, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(`${API_URL}/evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ev),
  })
  if (!res.ok) throw new Error(`POST /evidence ${res.status}`)
}
