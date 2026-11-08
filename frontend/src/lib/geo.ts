// The ONLY place coordinates are converted. Three shapes are in play and mixing them up puts the
// ghosts in the ocean off Somalia:
//
//   contract   GeoPoint            { lat, lon }     (Pydantic models, REST bodies)
//   deck.gl    LonLat              [lon, lat]       (longitude first)
//   MapLibre   LngLat              { lng, lat }     (camera, markers, flyTo)
//
// Every other file calls these helpers. `scripts/check-geo.sh` (npm run check:geo) fails if
// anything else builds a coordinate pair by hand.
import type { GeoPoint } from '@/types'

export type LonLat = readonly [lon: number, lat: number]
export interface LngLat { lng: number; lat: number }

// ---- GeoPoint <-> deck.gl [lon, lat]
export const toLonLat = (p: GeoPoint): [number, number] => [p.lon, p.lat]
export const fromLonLat = ([lon, lat]: LonLat): GeoPoint => ({ lat, lon })

// ---- GeoPoint <-> MapLibre { lng, lat }
export const toLngLat = (p: GeoPoint): LngLat => ({ lng: p.lon, lat: p.lat })
export const fromLngLat = (p: LngLat): GeoPoint => ({ lat: p.lat, lon: p.lng })

// ---- deck.gl <-> MapLibre, for the rare case with no GeoPoint in between
export const lonLatToLngLat = ([lon, lat]: LonLat): LngLat => ({ lng: lon, lat })
export const lngLatToLonLat = (p: LngLat): [number, number] => [p.lng, p.lat]

/** Lists of points (routes, polygons) in deck.gl order. */
export const toLonLatPath = (pts: readonly GeoPoint[]): [number, number][] => pts.map(toLonLat)

// ---- Metres <-> degrees (flat-earth, fine at city scale; same constant as backend/engine/interface.py)
export const M_PER_DEG_LAT = 111_320

const cosLat = (atLatDeg: number): number => Math.cos((atLatDeg * Math.PI) / 180)

/** A distance in metres as degrees of latitude and longitude at the given latitude. */
export function metresToDegrees(metres: number, atLatDeg: number): { dLat: number; dLon: number } {
  return { dLat: metres / M_PER_DEG_LAT, dLon: metres / (M_PER_DEG_LAT * cosLat(atLatDeg)) }
}

/** Degree deltas as metres east (dLon) and north (dLat) at the given latitude. */
export function degreesToMetres(dLon: number, dLat: number, atLatDeg: number): { east: number; north: number } {
  return { east: dLon * M_PER_DEG_LAT * cosLat(atLatDeg), north: dLat * M_PER_DEG_LAT }
}

/** The point `east` metres east and `north` metres north of `origin`. */
export function offsetPoint(origin: GeoPoint, east: number, north: number): GeoPoint {
  const { dLat, dLon } = metresToDegrees(1, origin.lat)
  return { lat: origin.lat + north * dLat, lon: origin.lon + east * dLon }
}

/** Great-circle-free distance in metres between two points (equirectangular, city scale). */
export function distanceMetres(a: GeoPoint, b: GeoPoint): number {
  const { east, north } = degreesToMetres(b.lon - a.lon, b.lat - a.lat, (a.lat + b.lat) / 2)
  return Math.hypot(east, north)
}

/** Rough sanity bounds for the demo city. Used to catch swapped lat/lon in tests and dev warnings. */
export const EDMONTON_BOUNDS = { minLat: 53.3, maxLat: 53.75, minLon: -113.8, maxLon: -113.2 } as const

export const isInEdmonton = (p: GeoPoint): boolean =>
  p.lat >= EDMONTON_BOUNDS.minLat && p.lat <= EDMONTON_BOUNDS.maxLat &&
  p.lon >= EDMONTON_BOUNDS.minLon && p.lon <= EDMONTON_BOUNDS.maxLon

/** Default "high over Alberta" camera target (step 10). */
export const ALBERTA_CENTRE: GeoPoint = { lat: 54.5, lon: -114.5 }

/** Downtown Edmonton, for "centre the map here" shortcuts. */
export const EDMONTON_CENTRE: GeoPoint = { lat: 53.5461, lon: -113.4938 }

/** The fictional demo case's last-seen point: 124 St & Jasper Ave (same as the backend's EDMONTON_DEFAULT). */
export const DEMO_LAST_SEEN: GeoPoint = { lat: 53.5422, lon: -113.5337 }

/** Places in the demo story (scenario/margaret.json), for the demo tips in lib/demoScript.ts. Fictional. */
export const DEMO_PLACES: Record<'lastSeen' | 'coffeeShop' | 'busStop' | 'droneSpot', GeoPoint> = {
  lastSeen: DEMO_LAST_SEEN,
  coffeeShop: { lat: 53.5424, lon: -113.5091 },   // 109 St & Jasper Ave
  busStop: { lat: 53.5328, lon: -113.5395 },      // Groat Rd & Emily Murphy Park Rd
  droneSpot: { lat: 53.534, lon: -113.537 },      // the grassy bank by the water
}

/** "53.5422, -113.5337": for display only (readouts, form status). */
export const formatPoint = (p: GeoPoint): string => `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`

/** The point `t` (0..1) of the way from `a` to `b` (straight line in lat/lon, fine at city scale). */
export const lerpPoint = (a: GeoPoint, b: GeoPoint, t: number): GeoPoint => ({
  lat: a.lat + (b.lat - a.lat) * t,
  lon: a.lon + (b.lon - a.lon) * t,
})

/** The average of some points (the middle of a small area), or null for none. */
export function centroid(pts: readonly GeoPoint[]): GeoPoint | null {
  if (pts.length === 0) return null
  return {
    lat: pts.reduce((sum, p) => sum + p.lat, 0) / pts.length,
    lon: pts.reduce((sum, p) => sum + p.lon, 0) / pts.length,
  }
}
