import { describe, expect, it } from 'vitest'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import { History, type FrameInfo } from './history'
import { ReplayRenderer, locate } from './replay'
import { FADE_MS, GHOST_ALPHA } from './smoother'
import { HISTORY, TRAIL_MS, VERTS } from './trails'

function frame(arrivalMs: number, xs: number[], over: Partial<FrameInfo> = {}): FrameInfo {
  const cur = new Float32Array(xs.length * FLOATS_PER_GHOST)
  xs.forEach((x, i) => {
    cur[i * FLOATS_PER_GHOST + OFFSET.longitude] = x
    cur[i * FLOATS_PER_GHOST + OFFSET.latitude] = 0
    cur[i * FLOATS_PER_GHOST + OFFSET.weight] = 1
  })
  return { arrivalMs, cur, count: xs.length, allRespawned: false, wasRespawned: () => false, simTime: arrivalMs, clusters: [], alive: 1, ...over }
}

/** A history with keyframes every second, slot 0 moving +10/s and slot 1 moving +10/s from 100. */
function build(seconds: number, respawn?: { atFrameMs: number; slot: number; newX: number }): History {
  const h = new History()
  for (let s = 0; s <= seconds; s++) {
    const t = s * 1000
    const xs = [s * 10, 100 + s * 10]
    if (respawn && t >= respawn.atFrameMs) xs[respawn.slot] = respawn.newX + (t - respawn.atFrameMs) / 100
    h.onFrame(frame(t, xs, { wasRespawned: (i) => !!respawn && i === respawn.slot && t === respawn.atFrameMs }))
  }
  return h
}
const x = (r: { out: { pos: Float32Array } }, slot: number) => r.out.pos[slot * 3]
const a = (r: { out: { col: Uint8ClampedArray } }, slot: number) => r.out.col[slot * 4 + 3]

describe('locate', () => {
  it('finds the last keyframe at or before T', () => {
    const h = build(5)
    expect(locate(h.keyframes, -50)).toBe(0)
    expect(locate(h.keyframes, 0)).toBe(0)
    expect(locate(h.keyframes, 2500)).toBe(2)
    expect(locate(h.keyframes, 5000)).toBe(5)
    expect(locate(h.keyframes, 99_000)).toBe(5)
  })
})

describe('ReplayRenderer', () => {
  it('glides linearly between keyframes and holds at the ends', () => {
    const h = build(5)
    const r = new ReplayRenderer()
    expect(x(r.render(h, 2500)!, 0)).toBeCloseTo(25, 4)
    expect(x(r.render(h, 3000)!, 0)).toBeCloseTo(30, 4)
    expect(x(r.render(h, 99_000)!, 0)).toBeCloseTo(50, 4) // never extrapolates
    expect(x(r.render(h, -500)!, 0)).toBeCloseTo(0, 4)
  })

  it('returns null with no recording', () => {
    expect(new ReplayRenderer().render(new History(), 0)).toBeNull()
  })

  it('shows simulation time and clusters of the keyframe at T', () => {
    const h = new History()
    const c = [{ id: 'cl_0', center: { lat: 1, lon: 2 }, probability: 0.3, evidence_ids: [] }]
    h.onFrame(frame(0, [1], { simTime: 111 }))
    h.onFrame(frame(1000, [2], { simTime: 222, clusters: c, alive: 0.9 }))
    const rf = new ReplayRenderer().render(h, 1500)!
    expect(rf.simTime).toBe(222)
    expect(rf.clusters).toBe(c)
    expect(rf.alive).toBe(0.9)
  })

  it('fades the swarm in at the start of a case', () => {
    const h = build(3)
    const r = new ReplayRenderer()
    expect(a(r.render(h, 0)!, 0)).toBe(0)
    expect(a(r.render(h, FADE_MS / 2)!, 0)).toBeGreaterThan(0)
    expect(a(r.render(h, FADE_MS / 2)!, 0)).toBeLessThan(GHOST_ALPHA)
    expect(a(r.render(h, FADE_MS)!, 0)).toBe(GHOST_ALPHA)
  })

  it('a respawned slot keeps its old spot until mid-interval, then appears at the new one and fades in (never glides)', () => {
    const h = build(6, { atFrameMs: 4000, slot: 1, newX: 9000 })
    const r = new ReplayRenderer()
    // the interval 3000..4000: slot 1 was replaced by a ghost at 9000
    expect(x(r.render(h, 3400)!, 1)).toBeCloseTo(130, 0) // holds the old ghost's last known spot, no jump yet
    expect(x(r.render(h, 3490)!, 1)).toBeLessThan(200)
    const after = r.render(h, 3600)!
    expect(x(after, 1)).toBeCloseTo(9000, 0) // new ghost, at once, not half-way across
    expect(a(after, 1)).toBeGreaterThan(0)
    expect(a(after, 1)).toBeLessThan(GHOST_ALPHA) // still fading in
    expect(a(r.render(h, 3500 + FADE_MS + 10)!, 1)).toBe(GHOST_ALPHA)
    // the neighbour never noticed
    expect(x(r.render(h, 3600)!, 0)).toBeCloseTo(36, 3)
  })

  it('never produces a visible jump between consecutive instants for slots that did not respawn', () => {
    const h = build(6, { atFrameMs: 4000, slot: 1, newX: 9000 })
    const r = new ReplayRenderer()
    let prev = x(r.render(h, 0)!, 0)
    for (let t = 16; t <= 6000; t += 16) {
      const cur = x(r.render(h, t)!, 0)
      expect(Math.abs(cur - prev)).toBeLessThan(0.3) // 10 units per second -> ~0.16 per frame
      prev = cur
    }
  })

  it('alternates output buffers so deck.gl re-uploads', () => {
    const h = build(3)
    const r = new ReplayRenderer()
    const first = r.render(h, 1000)!
    const second = r.render(h, 1010)!
    expect(first.out.pos).not.toBe(second.out.pos)
  })
})

describe('ReplayRenderer trails', () => {
  it('rebuilds a ~3 s tail ending at the ghost, oldest vertex first, head at T', () => {
    const h = build(8)
    const rf = new ReplayRenderer().render(h, 6000)!
    const t = rf.trails
    expect(t.currentTime).toBe(6000)
    const k = 0 // trail 0 follows slot 0
    const head = (k * VERTS + HISTORY) * 3
    expect(t.path[head]).toBeCloseTo(60, 3) // the ghost's position now
    const oldest = t.path[k * VERTS * 3]
    expect(oldest).toBeCloseTo(60 - (TRAIL_MS / 1000) * 10, 1) // ~30 a second-times-3 earlier
    for (let v = 1; v < VERTS; v++) {
      expect(t.timestamps[k * VERTS + v]).toBeGreaterThanOrEqual(t.timestamps[k * VERTS + v - 1])
      expect(t.path[(k * VERTS + v) * 3]).toBeGreaterThanOrEqual(t.path[(k * VERTS + v - 1) * 3])
    }
    expect(t.timestamps[k * VERTS + HISTORY]).toBe(6000)
  })

  it('a replayed tail never joins a dead ghost to its replacement', () => {
    const h = build(8, { atFrameMs: 5000, slot: 1, newX: 9000 })
    const r = new ReplayRenderer()
    for (const T of [4900, 5100, 5300, 5600, 6500]) {
      const t = r.render(h, T)!.trails
      const k = 1
      let longest = 0
      for (let v = 1; v < VERTS; v++) longest = Math.max(longest, Math.abs(t.path[(k * VERTS + v) * 3] - t.path[(k * VERTS + v - 1) * 3]))
      expect(longest).toBeLessThan(40) // ordinary motion only, never ~8,900
    }
  })
})

describe('ReplayRenderer: the dissolve, replayed (step 38 "ghosts un-dying")', () => {
  // slot 1 is replaced between the keyframes at 2 s and 3 s: the replay swaps old for new at 2.5 s
  const h = build(6, { atFrameMs: 3000, slot: 1, newX: 500 })
  const r = new ReplayRenderer()
  const dying = (T: number, ms?: number) => r.render(h, T, 40, 3, ms)!.dying

  it('keeps the old ghost where it was and fades it out over 600 ms from the swap, then it is gone', () => {
    expect(dying(2400).count).toBe(0) // before the swap the old ghost is just an ordinary ghost
    const start = dying(2500)
    expect(start.count).toBe(1)
    expect(start.pos[0]).toBeCloseTo(120, 3) // slot 1 at the 2 s keyframe: 100 + 2 * 10
    expect(start.col[3]).toBe(GHOST_ALPHA)
    expect(start.haloRadius[0]).toBeCloseTo(40, 3)
    const mid = dying(2800)
    expect(mid.col[3]).toBeLessThan(GHOST_ALPHA)
    expect(mid.col[3]).toBeGreaterThan(0)
    expect(mid.haloRadius[0]).toBeLessThan(40)
    expect(dying(3100).count).toBe(0) // 600 ms after the swap
  })

  it('only the replaced slot dissolves, and the new ghost fades in meanwhile', () => {
    const rf = r.render(h, 2700, 40, 3)!
    expect(rf.dying.count).toBe(1) // slot 0 was never replaced
    expect(x(rf, 1)).toBeCloseTo(500 + (3000 - 3000) / 100, 3) // the new ghost is at its new place
    expect(a(rf, 1)).toBeGreaterThan(0)
    expect(a(rf, 1)).toBeLessThan(GHOST_ALPHA) // still fading in
  })

  it('un-dies: scrubbing BACKWARDS across the swap brings the old ghost back, never the other way', () => {
    const alphas: number[] = []
    for (let T = 3100; T >= 2500; T -= 50) alphas.push(dying(T).count ? dying(T).col[3] : 0)
    for (let k = 1; k < alphas.length; k++) expect(alphas[k]).toBeGreaterThanOrEqual(alphas[k - 1])
    expect(alphas[0]).toBe(0)
    expect(alphas.at(-1)).toBe(GHOST_ALPHA)
  })

  it('shows nothing when the dissolve is switched off (reduced motion)', () => {
    expect(dying(2600, 0).count).toBe(0)
  })
})
