// What an evidence card and its map mark are made of (step 19), as pure functions.
import { offsetPoint } from '@/lib/geo'
import type { Evidence, EvidenceKind, EvidenceSource, GeoPoint } from '@/types'

/** How long a typed tip shows "Parsing" before it settles into a plain note. */
export const PARSE_MS = 6000

export const KIND_LABEL: Record<EvidenceKind, string> = {
  last_seen: 'Last seen',
  sighting: 'Sighting',
  clue: 'Clue',
  searched_area: 'Searched area',
  favourite_place: 'Favourite place',
  constraint: 'Constraint',
  note: 'Note',
}

export const SOURCE_LABEL: Record<EvidenceSource, string> = {
  officer: 'Officer',
  family: 'Family',
  witness: 'Witness',
  drone_ai: 'Drone AI',
  ground_team: 'Ground team',
  transit: 'Transit',
  camera: 'Camera',
  registry: 'Registry',
}

/** Kinds drawn on the map as a pin or a small marker. */
export const PIN_KINDS: readonly EvidenceKind[] = ['sighting', 'clue', 'favourite_place', 'last_seen']
/** Kinds drawn as a muted hatched shape ("covered", "off limits"). */
export const AREA_KINDS: readonly EvidenceKind[] = ['searched_area', 'constraint']

export const reliabilityOf = (e: Evidence): number => e.reliability ?? 0.7
/**
 * The picture for a card (a drone crop), or null. Only a path on this site ("/crops/x.jpg", which the dev server and
 * the build both serve from public/) or an http(s) address is used; anything else (javascript:, data:, a bare word)
 * is ignored rather than put in an <img>.
 */
export function mediaSrc(e: Pick<Evidence, 'media_url'>): string | null {
  const u = e.media_url?.trim()
  if (!u) return null
  if (u.startsWith('/') && !u.startsWith('//')) return u
  return /^https?:\/\//i.test(u) ? u : null
}

export const isConfirmed = (e: Evidence): boolean => e.confirmed ?? false

/** A note the AI has not structured yet: raw text, no place on the map. */
export function isPlainNote(e: Evidence): boolean {
  return e.kind === 'note' && !e.location && !(e.area && e.area.length > 0)
}

/** Shows the "Parsing" state: an officer's plain note, seen for less than PARSE_MS. */
export function isParsing(e: Evidence, seenAtMs: number, nowMs: number): boolean {
  return isPlainNote(e) && e.source === 'officer' && nowMs - seenAtMs < PARSE_MS
}

/** The summary was written by the AI (a drone detection, or a typed tip the AI turned into a card): shown in cyan. */
export function isAiText(e: Evidence): boolean {
  return e.source === 'drone_ai' || (e.kind !== 'note' && !!e.raw_text)
}

/** The line a card shows: a plain note shows exactly what was typed. */
export function cardText(e: Evidence): string {
  return isPlainNote(e) ? (e.raw_text ?? e.summary) : e.summary
}

/** A circle as a polygon ring (closed), for drawing a searched radius. Distances in metres. */
export function circlePolygon(center: GeoPoint, radiusM: number, steps = 48): GeoPoint[] {
  const ring: GeoPoint[] = []
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    ring.push(offsetPoint(center, Math.cos(a) * radiusM, Math.sin(a) * radiusM))
  }
  ring.push(ring[0])
  return ring
}

/** The polygon to hatch for an area-type evidence item: its own area, or a circle from location + radius. */
export function areaPolygon(e: Evidence): GeoPoint[] | null {
  if (!AREA_KINDS.includes(e.kind)) return null
  if (e.area && e.area.length >= 3) return [...e.area, e.area[0]]
  if (e.location) return circlePolygon(e.location, e.radius_m ?? 200)
  return null
}

/** Where the camera should look for this evidence, if anywhere. */
export function focusPoint(e: Evidence): GeoPoint | null {
  if (e.location) return e.location
  if (e.area && e.area.length > 0) return e.area[0]
  return null
}

/** Visible at replay time T? Live shows everything. Evidence seen before the recording began is always visible. */
export function visibleAt(replay: { mode: string; t: number | null } | null, firstSeenT: number | undefined): boolean {
  if (!replay || replay.mode === 'live' || replay.t === null) return true
  return firstSeenT === undefined || firstSeenT <= replay.t
}
