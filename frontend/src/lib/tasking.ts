// What a tasking card is made of (step 21), as pure functions: the gauge number, the sentence under it, the
// constraint row, the closed outline of the target area, which cards are waiting and which are decided, and
// who decided (read back from the log, since the log entry is the record of the decision).
import { centroid, toLonLatPath } from '@/lib/geo'
import type { GeoPoint, LogEntry, TaskingRequest, WithId } from '@/types'

export type Request = WithId<TaskingRequest>

export const CONSTRAINTS = [
  { key: 'battery', label: 'Battery' },
  { key: 'line_of_sight', label: 'Line of sight' },
  { key: 'airspace', label: 'Airspace' },
  { key: 'wind', label: 'Wind' },
] as const

export type ConstraintState = 'ok' | 'fail' | 'unknown'

/** The four checks the officer cares about; one the backend did not report shows as unknown, never as passed. */
export function constraintRows(r: TaskingRequest): { key: string; label: string; state: ConstraintState }[] {
  const c = r.constraints_ok ?? {}
  return CONSTRAINTS.map(({ key, label }) => ({
    key,
    label,
    state: key in c ? (c[key] ? 'ok' : 'fail') : 'unknown',
  }))
}

/** Expected gain as a whole percent, kept inside 0 to 100 so a bad number cannot break the gauge. */
export const gainPercent = (r: Pick<TaskingRequest, 'expected_gain'>): number =>
  Math.round(Math.min(1, Math.max(0, Number.isFinite(r.expected_gain) ? r.expected_gain : 0)) * 100)

export const gainSentence = (r: TaskingRequest): string =>
  `covers ${gainPercent(r)}% of remaining probability in ${r.duration_min} min`

/** The target area as a closed ring of [lon, lat] for the map, or null when it is not an area. */
export function targetRing(r: Pick<TaskingRequest, 'target_area'>): [number, number][] | null {
  const pts: GeoPoint[] = r.target_area ?? []
  if (pts.length < 3) return null
  const ring = toLonLatPath(pts)
  return [...ring, ring[0]]
}

/** The first point of the target area, for flying the camera there. */
export const areaCentre = (r: Pick<TaskingRequest, 'target_area'>): GeoPoint | null => centroid(r.target_area ?? [])

/** Pending first (newest on top), decided after (newest on top). `visible` lets replay hide what had not arrived. */
export function splitRequests(
  order: string[],
  byId: Record<string, Request>,
  visible: (id: string) => boolean = () => true,
): { pending: string[]; decided: string[] } {
  const pending: string[] = []
  const decided: string[] = []
  for (const id of [...order].reverse()) {
    const r = byId[id]
    if (!r || !visible(id)) continue
    ;(r.status === 'pending' || r.status === undefined ? pending : decided).push(id)
  }
  return { pending, decided }
}

/** Who decided, from the log. The backend writes `<asset>: <status> (<reason>)` under action "decision". */
export function decisionFor(log: readonly LogEntry[], r: Pick<TaskingRequest, 'asset' | 'status'>): { who: string; time: string; reason: string | null } | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]
    if (e.action === 'decision' && e.detail.startsWith(`${r.asset}: ${r.status}`)) {
      return { who: e.actor ?? 'Officer', time: e.time ?? '', reason: e.detail.match(/\((.*)\)\s*$/)?.[1] ?? null }
    }
  }
  return null
}
