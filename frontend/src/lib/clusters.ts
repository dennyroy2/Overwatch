// Cluster identity and selection (step 17), as pure functions so they are easy to test.
//
// The backend names clusters by RANK (`cl_0` is the biggest right now), so when two clusters swap rank
// their ids swap places. Anything keyed on the id would silently jump to a different location: a ring
// would teleport and a selected cluster would become a different place. So we track clusters by WHERE
// they are: the same place stays the same thing, whatever its id says this frame.
import { distanceMetres } from '@/lib/geo'
import type { Cluster, GeoPoint } from '@/types'

/** A cluster moves at most this far between frames (m) and still counts as the same place. */
export const MATCH_M = 500
/** A selected place follows the nearest cluster within this distance (m); beyond it the selection clears. */
export const SELECT_FOLLOW_M = 500

/** The cluster nearest `place` within `maxM`, or null. Ties go to the larger probability. */
export function resolveSelection(clusters: readonly Cluster[], place: GeoPoint | null, maxM = SELECT_FOLLOW_M): Cluster | null {
  if (!place) return null
  let best: Cluster | null = null
  let bestD = Infinity
  for (const c of clusters) {
    const d = distanceMetres(place, c.center)
    if (d > maxM) continue
    if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && best && c.probability > best.probability)) {
      best = c
      bestD = d
    }
  }
  return best
}

export interface Track {
  /** Stable for as long as the place exists, even when the backend's id (rank) changes. */
  key: number
  clusterId: string
  center: GeoPoint
  probability: number
}

/** Matches each frame's clusters to the previous frame's by proximity, giving each place a stable key. */
export class ClusterTracker {
  private tracks: Track[] = []
  private nextKey = 1

  update(clusters: readonly Cluster[]): Track[] {
    // Every (track, cluster) pair within range, nearest first: greedy nearest-neighbour assignment.
    const pairs: { t: number; c: number; d: number }[] = []
    this.tracks.forEach((t, ti) => {
      clusters.forEach((c, ci) => {
        const d = distanceMetres(t.center, c.center)
        if (d <= MATCH_M) pairs.push({ t: ti, c: ci, d })
      })
    })
    pairs.sort((a, b) => a.d - b.d)
    const takenT = new Set<number>()
    const takenC = new Set<number>()
    const next: Track[] = new Array(clusters.length)
    for (const p of pairs) {
      if (takenT.has(p.t) || takenC.has(p.c)) continue
      takenT.add(p.t)
      takenC.add(p.c)
      const c = clusters[p.c]
      next[p.c] = { key: this.tracks[p.t].key, clusterId: c.id, center: c.center, probability: c.probability }
    }
    clusters.forEach((c, ci) => {
      if (!takenC.has(ci)) next[ci] = { key: this.nextKey++, clusterId: c.id, center: c.center, probability: c.probability }
    })
    this.tracks = next
    return next
  }

  reset(): void {
    this.tracks = []
  }
}

/** Indices (into `tracks`) of the `n` most probable clusters, most probable first. These are the labelled ones. */
export function topIndices(tracks: readonly Track[], n = 3): number[] {
  return tracks
    .map((t, i) => ({ i, p: t.probability }))
    .sort((a, b) => b.p - a.p)
    .slice(0, n)
    .map((x) => x.i)
}

/** Ring diameter in px for a probability: bigger means more probable, but never so small it can't be clicked. */
export function ringDiameterPx(probability: number): number {
  const p = Math.min(1, Math.max(0, probability))
  return Math.round(36 + 84 * Math.sqrt(p))
}
