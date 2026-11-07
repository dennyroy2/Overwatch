import { describe, expect, it } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { createGroundSampler, LIFT_M } from './elevation'
import { FLOATS_PER_GHOST, OFFSET } from '@/stream/ghostBuffer'

// A tilted plane of "terrain": height depends on position, so interpolation errors show up.
const plane = (lng: number, lat: number) => 1000 + (lng + 113.5) * 10_000 + (lat - 53.5) * 20_000
const fakeMap = (h: (lng: number, lat: number) => number | null) =>
  ({ queryTerrainElevation: (p: { lng: number; lat: number }) => h(p.lng, p.lat) }) as unknown as MapLibreMap

function slots(points: [number, number][]): Float32Array {
  const buf = new Float32Array(points.length * FLOATS_PER_GHOST)
  points.forEach(([lon, lat], i) => {
    buf[i * FLOATS_PER_GHOST + OFFSET.longitude] = lon
    buf[i * FLOATS_PER_GHOST + OFFSET.latitude] = lat
  })
  return buf
}
const zOf = (buf: Float32Array, i: number) => buf[i * FLOATS_PER_GHOST + OFFSET.elevation]

describe('ground sampler', () => {
  it('puts each ghost on the interpolated ground plus the lift', () => {
    const pts: [number, number][] = [[-113.5337, 53.5422], [-113.5300, 53.5400], [-113.5400, 53.5450], [-113.5350, 53.5390]]
    const buf = slots(pts)
    createGroundSampler(fakeMap(plane)).apply(buf, pts.length)
    pts.forEach(([lon, lat], i) => {
      // A plane is reproduced exactly by bilinear interpolation (float32 rounding aside)
      expect(zOf(buf, i)).toBeCloseTo(plane(lon, lat) + LIFT_M, 0)
    })
  })

  it('exaggerated terrain in, exaggerated ghosts out (it trusts MapLibre\'s heights)', () => {
    const buf = slots([[-113.53, 53.54], [-113.52, 53.55]])
    createGroundSampler(fakeMap((lng, lat) => 2 * plane(lng, lat))).apply(buf, 2)
    expect(zOf(buf, 0)).toBeCloseTo(2 * plane(-113.53, 53.54) + LIFT_M, 0)
  })

  it('leaves z at 0 until any terrain has loaded, then fills in', () => {
    let loaded = false
    const buf = slots([[-113.53, 53.54], [-113.52, 53.55]])
    const s = createGroundSampler(fakeMap((lng, lat) => (loaded ? plane(lng, lat) : null)))
    s.apply(buf, 2)
    expect(zOf(buf, 0)).toBe(0)
    expect(s.stats().holes).toBeGreaterThan(0)
    loaded = true
    s.markStale()
    s.step(1e9) // refills run in slices on the animation-frame loop
    expect(s.takeSwapped()).toBe(true) // new heights landed: the caller re-runs apply
    s.apply(buf, 2)
    expect(s.stats().holes).toBe(0)
    expect(zOf(buf, 0)).toBeCloseTo(plane(-113.53, 53.54) + LIFT_M, 0)
  })

  it('refills only the holes, without a full rebuild', () => {
    let loaded = false
    const buf = slots([[-113.53, 53.54], [-113.52, 53.55]])
    const s = createGroundSampler(fakeMap((lng, lat) => (loaded || lng > -113.525 ? plane(lng, lat) : null)))
    s.apply(buf, 2)
    const first = s.stats()
    expect(first.holes).toBeGreaterThan(0)
    expect(first.holes).toBeLessThan(first.nodes)
    expect(first.rebuilds).toBe(1)
  })

  it('does not rebuild when ghosts stay inside the grid, and rebuilds when they leave it', () => {
    const s = createGroundSampler(fakeMap(plane))
    const buf = slots([[-113.53, 53.54], [-113.52, 53.55]])
    s.apply(buf, 2)
    s.apply(buf, 2)
    expect(s.stats().rebuilds).toBe(1)
    const far = slots([[-113.53, 53.54], [-113.30, 53.65]])
    s.apply(far, 2)
    s.step(1e9)
    expect(s.stats().rebuilds).toBe(2)
  })

  it('builds a grown grid in bounded slices, not in one stall (the step 18 hitch fix)', () => {
    let calls = 0
    const counting = { queryTerrainElevation: (p: { lng: number; lat: number }) => { calls += 1; return plane(p.lng, p.lat) } } as unknown as MapLibreMap
    const s = createGroundSampler(counting)
    s.apply(slots([[-113.53, 53.54], [-113.52, 53.55]]), 2) // first grid: built at once
    const firstCalls = calls
    expect(s.stats().rebuilds).toBe(1)
    // the swarm outgrows it
    s.apply(slots([[-113.53, 53.54], [-113.30, 53.65]]), 2)
    expect(calls).toBe(firstCalls) // apply itself does NO terrain queries for a growth
    expect(s.stats().rebuilds).toBe(1) // not built yet
    expect(s.stats().pendingNodes).toBeGreaterThan(100)
    // every slice does a bounded amount of work, yet always makes progress
    let slices = 0
    let maxPerSlice = 0
    while (s.stats().pendingNodes > 0) {
      const before = calls
      s.step(0)
      maxPerSlice = Math.max(maxPerSlice, calls - before)
      expect(calls).toBeGreaterThan(before)
      slices += 1
      expect(slices).toBeLessThan(10_000)
    }
    expect(maxPerSlice).toBeLessThanOrEqual(32)
    expect(slices).toBeGreaterThan(10) // spread over many frames, not one
    expect(s.stats().rebuilds).toBe(2)
  })

  it('keeps serving ghosts from the old grid while a bigger one is built, then swaps once', () => {
    const s = createGroundSampler(fakeMap(plane))
    const inside = slots([[-113.53, 53.54]])
    s.apply(inside, 1)
    expect(s.takeSwapped()).toBe(true) // the first grid; the render loop reads this flag every frame
    const before = zOf(inside, 0)
    s.apply(slots([[-113.53, 53.54], [-113.30, 53.65]]), 2) // growth starts; nothing is swapped yet
    const during = slots([[-113.53, 53.54]])
    s.apply(during, 1)
    expect(zOf(during, 0)).toBeCloseTo(before, 3) // an inside ghost is undisturbed
    expect(s.takeSwapped()).toBe(false)
    s.step(1e9)
    expect(s.takeSwapped()).toBe(true)
    expect(s.takeSwapped()).toBe(false) // reads once
    const after = slots([[-113.53, 53.54]])
    s.apply(after, 1)
    expect(zOf(after, 0)).toBeCloseTo(plane(-113.53, 53.54) + LIFT_M, 0) // exact again on the new grid
  })

  it('does not restart a build that already covers the swarm', () => {
    let calls = 0
    const counting = { queryTerrainElevation: (p: { lng: number; lat: number }) => { calls += 1; return plane(p.lng, p.lat) } } as unknown as MapLibreMap
    const s = createGroundSampler(counting)
    s.apply(slots([[-113.53, 53.54], [-113.52, 53.55]]), 2)
    const wide = slots([[-113.53, 53.54], [-113.30, 53.65]])
    s.apply(wide, 2)
    const pendingAfterFirst = s.stats().pendingNodes
    s.step(0)
    const mid = s.stats().pendingNodes
    s.apply(wide, 2) // same swarm again while the build is half way
    s.apply(wide, 2)
    expect(s.stats().pendingNodes).toBe(mid) // progress kept; nothing restarted
    expect(mid).toBeLessThan(pendingAfterFirst)
  })

  it('caps the grid so a build stays cheap', () => {
    const s = createGroundSampler(fakeMap(plane))
    s.apply(slots([[-113.9, 53.3], [-113.1, 53.8]]), 2) // ~50 km wide
    expect(s.stats().nodes).toBeLessThanOrEqual(48 * 48)
  })

  it('does nothing for an empty frame', () => {
    const s = createGroundSampler(fakeMap(plane))
    s.apply(new Float32Array(0), 0)
    expect(s.stats().rebuilds).toBe(0)
  })
})
