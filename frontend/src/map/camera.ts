// Camera moves. All coordinate conversion goes through lib/geo.ts (hard rule 7).
import type { Map as MapLibreMap } from 'maplibre-gl'
import { ALBERTA_CENTRE, toLngLat } from '@/lib/geo'
import { useStore, type StoreState } from '@/store'
import type { GeoPoint } from '@/types'

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
  else map.flyTo({ ...target, duration, curve: 1.5 })
}

export function flyToOverview(map: MapLibreMap): void {
  const target = overviewCamera()
  const duration = cameraMs()
  if (duration === 0) map.jumpTo(target)
  else map.flyTo({ ...target, duration })
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
