// Camera moves. All coordinate conversion goes through lib/geo.ts (hard rule 7).
import { LngLatBounds, type Map as MapLibreMap } from 'maplibre-gl'
import { ALBERTA_CENTRE, toLngLat } from '@/lib/geo'
import { useStore, type StoreState } from '@/store'
import type { GeoPoint } from '@/types'

/**
 * MapLibre 5.24 terrain workaround. `flyTo` freezes elevation at the start of a flight but only
 * releases it when `freezeElevation: true` is passed; by default the freeze sticks and the camera
 * keeps a stale (often 0) ground height, so the view ends up inside the buildings.
 *
 * With the flag set, the flight holds the start elevation and re-solves the zoom against the ground
 * at the end. That is accurate only if MapLibre already KNOWS the ground height when the flight
 * starts (starting at 0 ends the flight at zoom ~18). So flights wait for the map to be idle first
 * (`whenIdle`). Verified: from an idle map the fly-in ends at zoom 14.64 with elevation 1,331 m.
 */
const FREEZE = true

/** Run `fn` now if the map has finished loading tiles and elevation, otherwise on its next `idle`. */
export function whenIdle(map: Pick<MapLibreMap, 'loaded' | 'once'>, fn: () => void): void {
  if (map.loaded()) fn()
  else map.once('idle', fn)
}

export const OVERVIEW = { zoom: 4.6, pitch: 0, bearing: 0 } as const
export const CASE_VIEW = { zoom: 14.6, pitch: 55, bearing: -17 } as const

/** Camera duration from the motion token (0 under prefers-reduced-motion). */
function cameraMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--ow-dur-camera')
  const ms = parseFloat(raw)
  return Number.isFinite(ms) ? ms : 2400
}

export function overviewCamera() {
  return { center: toLngLat(ALBERTA_CENTRE), ...OVERVIEW }
}

export function flyToCase(map: MapLibreMap, lastSeen: GeoPoint): void {
  const target = { center: toLngLat(lastSeen), ...CASE_VIEW }
  const duration = cameraMs()
  if (duration === 0) map.jumpTo(target)
  else whenIdle(map, () => map.flyTo({ ...target, duration, curve: 1.5, freezeElevation: FREEZE }))
}

export function flyToArea(map: MapLibreMap, centre: GeoPoint, zoom: number): void {
  const target = { center: toLngLat(centre), zoom, pitch: 0, bearing: 0 }
  const duration = cameraMs()
  if (duration === 0) map.jumpTo(target)
  else whenIdle(map, () => map.flyTo({ ...target, duration: Math.min(duration, 1400), freezeElevation: FREEZE }))
}

/**
 * Ease the camera so a whole set of points (a route and its target) fits between the two rails, above the time
 * bar. Keeps the current pitch and bearing. Used when an approved request's route starts to draw.
 */
export function frameRoute(map: MapLibreMap, pts: readonly GeoPoint[]): void {
  if (pts.length === 0) return
  const [first, ...rest] = pts.map(toLngLat)
  const bounds = rest.reduce((b, p) => b.extend(p), new LngLatBounds(first, first))
  const duration = Math.min(cameraMs(), 1800)
  const padding = { top: 110, bottom: 220, left: 400, right: 400 }
  if (duration === 0) {
    const cam = map.cameraForBounds(bounds, { padding, maxZoom: 16.2 })
    if (cam) map.jumpTo(cam)
  } else {
    whenIdle(map, () => map.fitBounds(bounds, { padding, maxZoom: 16.2, duration, freezeElevation: FREEZE }))
  }
}

/** Gently centre on a point (same zoom, pitch and bearing). Used when a new located item arrives. */
export function easeToPoint(map: MapLibreMap, p: GeoPoint): void {
  const duration = Math.min(cameraMs(), 1400)
  if (duration === 0) map.jumpTo({ center: toLngLat(p) })
  else whenIdle(map, () => map.easeTo({ center: toLngLat(p), duration, freezeElevation: FREEZE }))
}

/** Fly to a point, zooming in at least to `minZoom` (used when the officer clicks a card). */
export function flyToPoint(map: MapLibreMap, p: GeoPoint, minZoom = 15.2): void {
  const target = { center: toLngLat(p), zoom: Math.max(map.getZoom(), minZoom) }
  const duration = Math.min(cameraMs(), 1600)
  if (duration === 0) map.jumpTo(target)
  else whenIdle(map, () => map.flyTo({ ...target, duration, freezeElevation: FREEZE }))
}

export function flyToOverview(map: MapLibreMap): void {
  const target = overviewCamera()
  const duration = cameraMs()
  if (duration === 0) map.jumpTo(target)
  else whenIdle(map, () => map.flyTo({ ...target, duration, freezeElevation: FREEZE }))
}

/**
 * When a case gets its last-seen point, fly in; when the case is closed, fly back out.
 * Reads the store outside React. Flies once per case id (hydrates and reconnects don't re-fly).
 */
export function watchCase(map: MapLibreMap): () => void {
  let flownFor: string | null = null
  const check = (s: StoreState) => {
    const p = s.caseProfile
    if (p?.case_id && p.last_seen) {
      if (flownFor !== p.case_id) {
        flownFor = p.case_id
        flyToCase(map, p.last_seen)
      }
    } else if (!p && flownFor) {
      flownFor = null
      flyToOverview(map)
    }
  }
  check(useStore.getState())
  return useStore.subscribe(check)
}
