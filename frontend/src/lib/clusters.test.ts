import { describe, expect, it } from 'vitest'
import { offsetPoint } from '@/lib/geo'
import { ClusterTracker, MATCH_M, SELECT_FOLLOW_M, resolveSelection, ringDiameterPx, topIndices } from './clusters'
import type { Cluster } from '@/types'

const ORIGIN = { lat: 53.5422, lon: -113.5337 }
const at = (east: number, north = 0) => offsetPoint(ORIGIN, east, north)
const cl = (id: string, east: number, probability: number, north = 0): Cluster => ({
  id, center: at(east, north), probability, evidence_ids: [],
})

describe('ClusterTracker', () => {
  it('keeps each place on the same key when the backend swaps ranks (ids swap, positions do not)', () => {
    const tr = new ClusterTracker()
    const a = tr.update([cl('cl_0', 0, 0.4), cl('cl_1', 3000, 0.3)])
    // the second place overtakes: now it is cl_0 and the first is cl_1. Same two places.
    const b = tr.update([cl('cl_0', 3010, 0.45), cl('cl_1', 5, 0.35)])
    expect(b[0].key).toBe(a[1].key) // the place at 3,000 m keeps its key although its id changed
    expect(b[1].key).toBe(a[0].key)
    expect(b[0].clusterId).toBe('cl_0')
  })

  it('follows a cluster that drifts a little each frame', () => {
    const tr = new ClusterTracker()
    let key = tr.update([cl('cl_0', 0, 0.3)])[0].key
    for (let k = 1; k <= 20; k++) {
      const t = tr.update([cl('cl_0', k * 100, 0.3)]) // 100 m per frame, well under MATCH_M
      expect(t[0].key).toBe(key)
      key = t[0].key
    }
  })

  it('gives a brand-new place a new key, and drops places that vanish', () => {
    const tr = new ClusterTracker()
    const a = tr.update([cl('cl_0', 0, 0.5)])
    const b = tr.update([cl('cl_0', 10, 0.5), cl('cl_1', 5000, 0.2)])
    expect(b[0].key).toBe(a[0].key)
    expect(b[1].key).not.toBe(a[0].key)
    const c = tr.update([cl('cl_0', 5010, 0.5)]) // the first place is gone; the one at 5 km remains
    expect(c[0].key).toBe(b[1].key)
  })

  it('does not match places further apart than MATCH_M', () => {
    const tr = new ClusterTracker()
    const a = tr.update([cl('cl_0', 0, 0.5)])
    const b = tr.update([cl('cl_0', MATCH_M + 200, 0.5)])
    expect(b[0].key).not.toBe(a[0].key)
  })

  it('assigns by nearest pairs, so two close clusters never swap keys', () => {
    const tr = new ClusterTracker()
    const a = tr.update([cl('cl_0', 0, 0.4), cl('cl_1', 300, 0.3)])
    const b = tr.update([cl('cl_0', 20, 0.4), cl('cl_1', 280, 0.3)])
    expect(b[0].key).toBe(a[0].key)
    expect(b[1].key).toBe(a[1].key)
  })

  it('handles an empty frame and reset', () => {
    const tr = new ClusterTracker()
    expect(tr.update([])).toEqual([])
    tr.update([cl('cl_0', 0, 0.5)])
    tr.reset()
    expect(tr.update([cl('cl_0', 0, 0.5)])[0].key).toBeGreaterThan(0)
  })
})

describe('resolveSelection (follow the place, not the id)', () => {
  it('keeps selecting the same PLACE after the ids swap', () => {
    const place = at(0)
    const before = resolveSelection([cl('cl_0', 0, 0.4), cl('cl_1', 3000, 0.3)], place)
    expect(before?.id).toBe('cl_0')
    // ranks swap: the place we selected is now called cl_1
    const after = resolveSelection([cl('cl_0', 3000, 0.45), cl('cl_1', 10, 0.35)], before?.center ?? null)
    expect(after?.id).toBe('cl_1') // the id changed, the place did not
    expect(after?.center).toEqual(at(10))
  })

  it('clears when no cluster is near the selected place any more', () => {
    expect(resolveSelection([cl('cl_0', SELECT_FOLLOW_M + 300, 0.5)], at(0))).toBeNull()
  })

  it('picks the nearest of several, and is null with no selection or no clusters', () => {
    const c = resolveSelection([cl('a', 400, 0.5), cl('b', 100, 0.1)], at(0))
    expect(c?.id).toBe('b')
    expect(resolveSelection([cl('a', 0, 0.5)], null)).toBeNull()
    expect(resolveSelection([], at(0))).toBeNull()
  })
})

describe('labels and ring size', () => {
  it('labels the most probable three, most probable first', () => {
    const tr = new ClusterTracker()
    const tracks = tr.update([cl('a', 0, 0.1), cl('b', 2000, 0.4), cl('c', 4000, 0.2), cl('d', 6000, 0.3)])
    expect(topIndices(tracks).map((i) => tracks[i].clusterId)).toEqual(['b', 'd', 'c'])
    expect(topIndices(tracks, 10).length).toBe(4)
  })

  it('rings grow with probability but stay clickable and bounded', () => {
    expect(ringDiameterPx(0.3)).toBeGreaterThan(ringDiameterPx(0.05))
    expect(ringDiameterPx(0)).toBeGreaterThanOrEqual(36)
    expect(ringDiameterPx(1)).toBeLessThanOrEqual(120)
    expect(ringDiameterPx(5)).toBe(ringDiameterPx(1)) // clamps
  })
})
