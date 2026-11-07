import { describe, expect, it } from 'vitest'
import { GhostSmoother } from './smoother'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import { HISTORY, SAMPLE_MS, TRAIL_MS, TRAIL_SLOTS, TrailBuffer, VERTS, type TrailSource } from './trails'

/** A fake source: slot i drawn at (x[i], 0, 0); `respawned` lists slots that are new this frame. */
function source(xs: number[], respawned: number[] = [], all = false): TrailSource {
  const drawn = new Float32Array(xs.length * 3)
  xs.forEach((x, i) => { drawn[i * 3] = x })
  return { drawnAtArrival: drawn, wasRespawned: (i) => all || respawned.includes(i) }
}
const head = (xs: number[]): Float32Array => {
  const h = new Float32Array(xs.length * 3)
  xs.forEach((x, i) => { h[i * 3] = x })
  return h
}
const vertexX = (out: { path: Float32Array }, trail: number, v: number) => out.path[(trail * VERTS + v) * 3]
const vertexT = (out: { timestamps: Float32Array }, trail: number, v: number) => out.timestamps[trail * VERTS + v]

describe('TrailBuffer', () => {
  it('records where each ghost was drawn, oldest first, with the smoothed position as the head', () => {
    const tb = new TrailBuffer()
    tb.onFrame(1000, 2, source([0, 100], [], true)) // first frame: new swarm, trails start empty
    for (let k = 1; k <= 5; k++) tb.onFrame(1000 + k * SAMPLE_MS, 2, source([k, 100 + k]))
    const out = tb.tick(2000, head([5.5, 105.5]))
    expect(out.length).toBe(2)
    // history is chronological: ... 3, 4, 5, then the head
    expect([vertexX(out, 0, HISTORY - 3), vertexX(out, 0, HISTORY - 2), vertexX(out, 0, HISTORY - 1)]).toEqual([3, 4, 5])
    expect(vertexX(out, 0, HISTORY)).toBeCloseTo(5.5)
    expect(vertexX(out, 1, HISTORY)).toBeCloseTo(105.5)
    // timestamps never go backwards along a trail
    for (let v = 1; v < VERTS; v++) expect(vertexT(out, 0, v)).toBeGreaterThanOrEqual(vertexT(out, 0, v - 1))
    expect(vertexT(out, 0, HISTORY)).toBe(out.currentTime) // head is "now"
  })

  it('a respawned slot loses its trail at once; the other slots keep theirs (no streak from the dead ghost)', () => {
    const tb = new TrailBuffer()
    tb.onFrame(0, 2, source([0, 100], [], true))
    for (let k = 1; k <= 6; k++) tb.onFrame(k * SAMPLE_MS, 2, source([k, 100 + k]))
    // slot 1 dies; its replacement spawns far away at x = 5000
    tb.onFrame(7 * SAMPLE_MS, 2, source([7, 5000], [1]))
    const out = tb.tick(7 * SAMPLE_MS, head([7, 5000]))
    for (let v = 0; v < HISTORY; v++) expect(vertexX(out, 1, v)).toBe(5000) // whole trail collapsed onto the new ghost
    // the neighbour's trail is intact and still ends at its latest sample
    expect(vertexX(out, 0, HISTORY - 1)).toBe(7)
    expect(vertexX(out, 0, HISTORY - 2)).toBe(6)
    // no segment of the new ghost's trail is longer than zero: nothing joins old position to new
    let longest = 0
    for (let v = 1; v < VERTS; v++) longest = Math.max(longest, Math.abs(vertexX(out, 1, v) - vertexX(out, 1, v - 1)))
    expect(longest).toBe(0)
  })

  it('wipes every trail when all slots respawn (the fallback until the backend sends the list)', () => {
    const tb = new TrailBuffer()
    tb.onFrame(0, 3, source([0, 10, 20], [], true))
    for (let k = 1; k <= 4; k++) tb.onFrame(k * SAMPLE_MS, 3, source([k, 10 + k, 20 + k]))
    tb.onFrame(5 * SAMPLE_MS, 3, source([500, 600, 700], [], true))
    const out = tb.tick(5 * SAMPLE_MS, head([500, 600, 700]))
    for (let t = 0; t < 3; t++) for (let v = 0; v < VERTS; v++) expect(vertexX(out, t, v)).toBe([500, 600, 700][t])
  })

  it('skips data frames that arrive faster than the sample spacing, so the tail keeps its length', () => {
    const tb = new TrailBuffer()
    tb.onFrame(0, 1, source([0], [], true))
    for (let k = 1; k <= 40; k++) tb.onFrame(k * 20, 1, source([k])) // 50 fps for 800 ms
    const out = tb.tick(800, head([40]))
    const recorded = new Set(Array.from({ length: HISTORY }, (_, v) => vertexX(out, 0, v)))
    recorded.delete(0)
    // 800 ms at one sample per 200 ms is 4 or 5 recorded samples, not 40
    expect(recorded.size).toBeLessThanOrEqual(6)
    expect(recorded.size).toBeGreaterThanOrEqual(3)
  })

  it('follows a fixed, evenly spaced subset of ghosts, never more than TRAIL_SLOTS', () => {
    const tb = new TrailBuffer()
    const n = 5000
    const xs = Array.from({ length: n }, (_, i) => i)
    tb.onFrame(0, n, source(xs, [], true))
    expect(tb.trailCount).toBe(TRAIL_SLOTS)
    const first = Array.from({ length: 10 }, (_, k) => tb.slotForTrail(k))
    tb.onFrame(SAMPLE_MS, n, source(xs))
    expect(Array.from({ length: 10 }, (_, k) => tb.slotForTrail(k))).toEqual(first) // same ghosts every frame
    expect(tb.slotForTrail(TRAIL_SLOTS - 1)).toBeLessThan(n)
    const gaps = first.slice(1).map((s, k) => s - first[k])
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1) // evenly spaced
  })

  it('tracks every ghost when there are fewer than TRAIL_SLOTS', () => {
    const tb = new TrailBuffer()
    tb.onFrame(0, 40, source(Array.from({ length: 40 }, (_, i) => i), [], true))
    expect(tb.trailCount).toBe(40)
    expect(Array.from({ length: 40 }, (_, k) => tb.slotForTrail(k))).toEqual(Array.from({ length: 40 }, (_, i) => i))
  })

  it('exposes constant-stride startIndices for deck.gl binary paths, and alternates output buffers', () => {
    const tb = new TrailBuffer()
    tb.onFrame(0, 3, source([0, 1, 2], [], true))
    const a = tb.tick(10, head([0, 1, 2]))
    const b = tb.tick(20, head([0, 1, 2]))
    expect(Array.from(a.startIndices)).toEqual([0, VERTS, 2 * VERTS, 3 * VERTS])
    expect(a.path).not.toBe(b.path)
    expect(a.timestamps).not.toBe(b.timestamps)
  })

  it('a long trail window is 3 seconds', () => {
    expect(TRAIL_MS).toBe(3000)
    expect(HISTORY).toBe(Math.ceil(TRAIL_MS / SAMPLE_MS) + 1)
  })

  it('resets when the swarm size changes or the case closes', () => {
    const tb = new TrailBuffer()
    tb.onFrame(0, 2, source([0, 1], [], true))
    tb.onFrame(100, 0, source([]))
    expect(tb.trailCount).toBe(0)
    expect(tb.tick(200, new Float32Array(0)).length).toBe(0)
  })
})

describe('TrailBuffer fed by the real smoother', () => {
  const frame = (xs: number[]) => {
    const buf = new Float32Array(xs.length * FLOATS_PER_GHOST)
    xs.forEach((x, i) => { buf[i * FLOATS_PER_GHOST + OFFSET.longitude] = x })
    return buf
  }

  it('follows the drawn glide and clears a respawned slot while its neighbour keeps its tail', () => {
    const sm = new GhostSmoother()
    const tb = new TrailBuffer()
    const feed = (t: number, xs: number[], respawned: number[] | null) => {
      sm.onFrame(t, frame(xs), xs.length, respawned ? Int32Array.from(respawned) : null, false)
      tb.onFrame(t, xs.length, sm)
    }
    feed(0, [0, 100], null) // new swarm
    for (let k = 1; k <= 6; k++) feed(k * 200, [k * 10, 100 + k * 10], null)
    feed(7 * 200, [70, 9000], [1]) // slot 1 died and respawned 9 km away
    const out = tb.tick(7 * 200 + 50, sm.tick(7 * 200 + 50).pos)
    // slot 0: tail reaches back to where it was drawn earlier, with small steps only
    let longest0 = 0
    for (let v = 1; v < VERTS; v++) longest0 = Math.max(longest0, Math.abs(vertexX(out, 0, v) - vertexX(out, 0, v - 1)))
    expect(longest0).toBeLessThan(25)
    // slot 1: no vertex is left at the old position, so nothing streaks 9 km
    for (let v = 0; v < VERTS; v++) expect(vertexX(out, 1, v)).toBeGreaterThan(8000)
  })
})
