// Geometry for the route animation (step 23): how long a route is, the point a given fraction of the way along it,
// and the part of it drawn so far. Pure, so the animation's maths can be tested without a map.
import { distanceMetres, lerpPoint } from '@/lib/geo'
import type { GeoPoint } from '@/types'

/** Total length in metres. */
export function routeLength(route: readonly GeoPoint[]): number {
  let m = 0
  for (let i = 1; i < route.length; i++) m += distanceMetres(route[i - 1], route[i])
  return m
}

/** Fraction 0..1 clamped (NaN counts as 0), so a bad clock can never push the animation off the route. */
export const clamp01 = (t: number): number => (Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0)

/** The route up to `fraction` of its length, ending exactly at the point reached. Needs at least two points. */
export function partialRoute(route: readonly GeoPoint[], fraction: number): GeoPoint[] {
  if (route.length < 2) return [...route]
  const f = clamp01(fraction)
  if (f >= 1) return [...route]
  const total = routeLength(route)
  if (total === 0) return [route[0], route[route.length - 1]]
  const target = total * f
  const out: GeoPoint[] = [route[0]]
  let walked = 0
  for (let i = 1; i < route.length; i++) {
    const seg = distanceMetres(route[i - 1], route[i])
    if (walked + seg >= target) {
      out.push(seg === 0 ? route[i] : lerpPoint(route[i - 1], route[i], (target - walked) / seg))
      return out
    }
    out.push(route[i])
    walked += seg
  }
  return out
}

/** Where the asset is `fraction` of the way along the route (the end of `partialRoute`). */
export function pointAlong(route: readonly GeoPoint[], fraction: number): GeoPoint | null {
  const part = partialRoute(route, fraction)
  return part.length === 0 ? null : part[part.length - 1]
}

/** Ease in and out, so the asset leaves and arrives smoothly instead of at constant speed. */
export const easeInOut = (t: number): number => {
  const x = clamp01(t)
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

/** The route animation's length: long enough to read, short enough for a demo. */
export const ROUTE_MS = 2600
