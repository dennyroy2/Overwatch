// What the camera does when an evidence card is clicked. It lives apart from the timeline so a test can pin it:
// a card that changed the swarm over a wide area must frame the WHOLE before-and-after, or the red (removed) and
// cyan (arrived) ghosts of step 36 can be off screen and the card looks like it did nothing.
import { framePoints } from '@/lib/attributionFrame'
import type { AttributionSnapshot } from '@/stream/attribution'
import type { GeoPoint } from '@/types'

export interface CardFocusDeps {
  /** What the card removed and brought in, or null (a plain note, no record, or not live). */
  snapshot: () => AttributionSnapshot | null
  frameRoute: (frame: GeoPoint[]) => void
  flyTo: (point: GeoPoint) => void
}

/** Frame the whole change if the card made one, otherwise fly to the card's own mark. */
export function focusCard(point: GeoPoint | null, deps: CardFocusDeps): void {
  const snap = deps.snapshot()
  const frame = snap ? framePoints(snap.removed, snap.removedCount, snap.arrived, snap.arrivedCount, point) : null
  if (frame) deps.frameRoute(frame)
  else if (point) deps.flyTo(point)
}
