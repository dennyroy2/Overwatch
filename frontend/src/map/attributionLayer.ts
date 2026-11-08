// The "what did this card remove, and what stayed or arrived?" overlay (step 36): the ghosts the card is credited with
// removing or dimming, where they were, in muted red; the ghosts that stayed in a quiet cyan; the new ghosts it brought in
// in bright cyan. It shows for a few
// seconds after a card is selected, fades in and out, and is drawn by the same deck.gl overlay as the ghosts.
// Colours are written as LINEAR light like every other ghost colour (see stream/smoother.ts GHOST_RGB_LINEAR).
import { ScatterplotLayer } from '@deck.gl/layers'
import { attribution, type AttributionSnapshot } from '@/stream/attribution'
import { currentBuffer, ghosts } from '@/stream/ghostBuffer'
import { srgbToLinear } from '@/stream/smoother'
import { tokens } from '@/lib/tokens'

export const ATTRIBUTION_MS = 5000
const FADE_IN_MS = 150
const FADE_OUT_MS = 700

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16))) as [number, number, number]
/** Muted, so it reads as "gone" and never competes with the amber swarm. */
const REMOVED_RGB = [...[201, 84, 74].map(srgbToLinear), 235] as [number, number, number, number]
/** Cyan is the colour of AI analysis in this design; this is an analysis of what the engine did. Stayed is the quieter cyan, arrived the bright one. */
const STAYED_RGB = [...hex(tokens.cyan), 120] as [number, number, number, number]
const ARRIVED_RGB = [...hex(tokens.cyan), 255] as [number, number, number, number]
const DOT_PX = 2.6

let view: { id: string; shownAt: number; snap: AttributionSnapshot } | null = null

/** How visible the overlay is `ageMs` after it was shown: quick fade in, hold, slow fade out. */
export function attributionOpacity(ageMs: number): number {
  if (ageMs < 0 || ageMs >= ATTRIBUTION_MS) return 0
  if (ageMs < FADE_IN_MS) return ageMs / FADE_IN_MS
  if (ageMs > ATTRIBUTION_MS - FADE_OUT_MS) return (ATTRIBUTION_MS - ageMs) / FADE_OUT_MS
  return 1
}

/** Show the overlay for evidence `id`. Returns what it shows, or null if this view has no record of that card. */
export function showAttribution(id: string, now = performance.now()): AttributionSnapshot | null {
  const snap = attribution.snapshot(id, ghosts.count, currentBuffer())
  view = snap ? { id, shownAt: now, snap } : null
  return snap
}

export function hideAttribution(): void {
  view = null
}

/** The overlay's layers for this frame (none when nothing is shown). */
export function attributionLayers(now: number, beforeId: string): ScatterplotLayer[] {
  if (!view) return []
  const opacity = attributionOpacity(now - view.shownAt)
  if (opacity <= 0) {
    if (now - view.shownAt >= ATTRIBUTION_MS) view = null
    return []
  }
  const { snap } = view
  const make = (id: string, pos: Float32Array, count: number, color: [number, number, number, number]) =>
    new ScatterplotLayer({
      id,
      beforeId,
      data: { length: count, attributes: { getPosition: { value: pos, size: 3 } } },
      getFillColor: color,
      getRadius: DOT_PX,
      radiusUnits: 'pixels',
      stroked: false,
      pickable: false,
      opacity,
      parameters: { depthWriteEnabled: false },
    })
  // Removed first, then what stayed, and what arrived on top: the arrivals are the part the officer is asked to look at.
  return [
    make('attr-removed', snap.removed, snap.removedCount, REMOVED_RGB),
    make('attr-stayed', snap.stayed, snap.stayedCount, STAYED_RGB),
    make('attr-arrived', snap.arrived, snap.arrivedCount, ARRIVED_RGB),
  ]
}
