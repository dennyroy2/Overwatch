// Where to point the camera when a card is selected and its overlay has something to show (step 36): the card's own
// place plus the extent of the ghosts it removed and the ghosts that arrived, so the whole before-and-after fits on
// screen (a sighting removes a cloud in one place and brings one up in another). Stragglers are trimmed (3rd to 97th
// percentile) so one lone ghost cannot zoom the map out to the whole city.
import { distanceMetres, fromLonLat } from '@/lib/geo'
import type { GeoPoint } from '@/types'

/** Below this the change is local and the normal fly-to-the-card is better than a framing move. */
export const MIN_FRAME_SPAN_M = 250
const TRIM = 0.03

function trimmedRange(values: number[]): [number, number] {
  values.sort((a, b) => a - b)
  const lo = values[Math.floor(values.length * TRIM)]
  const hi = values[Math.min(values.length - 1, Math.ceil(values.length * (1 - TRIM)) - 1)]
  return [lo, hi]
}

/** `lonLatZ` arrays are [lon, lat, elevation] per ghost. Returns the points to frame, or null when the change is local or empty. */
export function framePoints(
  removed: Float32Array, removedCount: number,
  arrived: Float32Array, arrivedCount: number,
  place: GeoPoint | null,
): GeoPoint[] | null {
  const lons: number[] = []
  const lats: number[] = []
  for (let i = 0; i < removedCount; i++) { lons.push(removed[i * 3]); lats.push(removed[i * 3 + 1]) }
  for (let i = 0; i < arrivedCount; i++) { lons.push(arrived[i * 3]); lats.push(arrived[i * 3 + 1]) }
  if (lons.length === 0) return null
  const [lon0, lon1] = trimmedRange(lons)
  const [lat0, lat1] = trimmedRange(lats)
  const sw = fromLonLat([lon0, lat0])
  const ne = fromLonLat([lon1, lat1])
  const pts = [sw, ne, fromLonLat([lon0, lat1]), fromLonLat([lon1, lat0])]
  if (place) pts.push(place)
  // The span the camera would have to cover, including the card's own place.
  const span = Math.max(distanceMetres(sw, ne), place ? Math.max(distanceMetres(place, sw), distanceMetres(place, ne)) : 0)
  return span >= MIN_FRAME_SPAN_M ? pts : null
}
