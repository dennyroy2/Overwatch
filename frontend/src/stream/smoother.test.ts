import { describe, expect, it } from 'vitest'
import { FADE_MS, GHOST_ALPHA, GHOST_RGB, GHOST_RGB_LINEAR, GhostSmoother, MIN_BRIGHTNESS, srgbToLinear, weightBrightness } from './smoother'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'

/** A frame in ghostBuffer layout: slot i at longitude xs[i], latitude 0, elevation 0, weight 1 unless given. */
function frame(xs: number[], weights?: number[]): Float32Array {
  const buf = new Float32Array(xs.length * FLOATS_PER_GHOST)
  xs.forEach((x, i) => {
    buf[i * FLOATS_PER_GHOST + OFFSET.longitude] = x
    buf[i * FLOATS_PER_GHOST + OFFSET.weight] = weights ? weights[i] : 1
  })
  return buf
}
const lon = (out: { pos: Float32Array }, i: number) => out.pos[i * 3]
const alpha = (out: { col: Uint8ClampedArray }, i: number) => out.col[i * 4 + 3]

describe('GhostSmoother', () => {
  it('glides between frames instead of hopping, and never extrapolates past the newest frame', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0]), 1, null, false)
    s.onFrame(200, frame([10]), 1, null, false)
    expect(lon(s.tick(200), 0)).toBeCloseTo(0, 5) // just arrived: still where it was
    expect(lon(s.tick(300), 0)).toBeCloseTo(5, 1) // half-way, by elapsed time
    expect(lon(s.tick(400), 0)).toBeCloseTo(10, 5)
    expect(lon(s.tick(5000), 0)).toBeCloseTo(10, 5) // no overshoot while waiting for the next frame
  })

  it('moves a ghost on every animation frame between two data frames (the step-13 fix)', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0]), 1, null, false)
    s.onFrame(200, frame([10]), 1, null, false)
    const positions = Array.from({ length: 12 }, (_, k) => lon(s.tick(200 + k * 16.7), 0))
    const distinct = new Set(positions.map((p) => p.toFixed(4)))
    expect(distinct.size).toBe(12) // 12 render frames, 12 different positions
    for (let k = 1; k < positions.length; k++) expect(positions[k]).toBeGreaterThan(positions[k - 1])
  })

  it('stays continuous when a frame arrives early: starts the next segment from where the ghost is drawn', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0]), 1, null, false)
    s.onFrame(200, frame([10]), 1, null, false)
    const before = lon(s.tick(300), 0) // drawn at ~5
    s.onFrame(300, frame([20]), 1, null, false) // arrives early, half-way through the segment
    const at = lon(s.tick(300), 0)
    expect(at).toBeCloseTo(before, 1) // no hop back to 10, no jump forward
    expect(lon(s.tick(5000), 0)).toBeCloseTo(20, 5)
  })

  it('a respawned slot snaps to its new position, starts hidden and fades in; others keep gliding', () => {
    const s = new GhostSmoother()
    s.onFrame(-2000, frame([0, 100]), 2, null, false) // case started long ago: the start fade-in is over
    s.onFrame(0, frame([0, 100]), 2, null, false)
    s.onFrame(200, frame([10, 500]), 2, Int32Array.of(1), false) // slot 1 died; the new ghost is at 500
    const out = s.tick(200)
    expect(lon(out, 0)).toBeCloseTo(0, 5) // slot 0 glides from its old position
    expect(lon(out, 1)).toBeCloseTo(500, 5) // slot 1 does NOT streak 100 -> 500
    expect(alpha(out, 0)).toBe(GHOST_ALPHA)
    expect(alpha(out, 1)).toBe(0)
    expect(alpha(s.tick(200 + FADE_MS / 2), 1)).toBeGreaterThan(0)
    expect(alpha(s.tick(200 + FADE_MS / 2), 1)).toBeLessThan(GHOST_ALPHA)
    expect(alpha(s.tick(200 + FADE_MS), 1)).toBe(GHOST_ALPHA)
    // while it fades, it is not moving across the map either
    expect(lon(s.tick(200 + 100), 1)).toBeCloseTo(500, 5)
  })

  it('treats every slot as respawned when asked (fallback until the backend sends the list)', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0, 100, 200]), 3, null, false)
    s.onFrame(200, frame([300, 400, 500]), 3, null, true)
    const out = s.tick(200)
    for (let i = 0; i < 3; i++) {
      expect(lon(out, i)).toBeCloseTo([300, 400, 500][i], 5)
      expect(alpha(out, i)).toBe(0)
    }
  })

  it('fades the whole swarm in when a case starts', () => {
    const s = new GhostSmoother()
    s.onFrame(1000, frame([1, 2]), 2, null, false)
    expect(alpha(s.tick(1000), 0)).toBe(0)
    expect(alpha(s.tick(1000 + FADE_MS), 1)).toBe(GHOST_ALPHA)
  })

  it('learns the frame interval from arrivals, clamped to a sane range', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0]), 1, null, false)
    for (let k = 1; k <= 20; k++) s.onFrame(k * 100, frame([k]), 1, null, false)
    expect(s.frameIntervalMs).toBeGreaterThan(95)
    expect(s.frameIntervalMs).toBeLessThan(120) // converged toward the real 100 ms gap
    s.onFrame(2100 + 60_000, frame([99]), 1, null, false) // a stalled connection
    expect(s.frameIntervalMs).toBeLessThanOrEqual(1000)
  })

  it('ignores out-of-range respawned indices and empty frames', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0, 1]), 2, null, false)
    expect(() => s.onFrame(200, frame([5, 6]), 2, Int32Array.of(-1, 7, 1), false)).not.toThrow()
    s.onFrame(300, new Float32Array(0), 0, null, false)
    expect(s.tick(300).count).toBe(0)
  })

  it('alternates output buffers so deck.gl sees new data every frame, and does not allocate per tick', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0, 1, 2]), 3, null, false)
    const a = s.tick(10)
    const b = s.tick(20)
    const c = s.tick(30)
    expect(a.pos).not.toBe(b.pos)
    expect(c.pos).toBe(a.pos)
  })

  it('handles a swarm bigger than the first allocation', () => {
    const s = new GhostSmoother()
    const n = 20_000
    const xs = Array.from({ length: n }, (_, i) => i)
    s.onFrame(0, frame(xs), n, null, false)
    s.onFrame(200, frame(xs.map((x) => x + 10)), n, null, false)
    expect(lon(s.tick(300), n - 1)).toBeCloseTo(n - 1 + 5, 1)
  })

  it('dims unlikely ghosts: brightness follows the probability weight, never below the floor', () => {
    const s = new GhostSmoother()
    s.onFrame(-2000, frame([0, 1, 2], [1, 0.5, 0]), 3, null, false)
    const out = s.tick(0)
    expect(alpha(out, 0)).toBe(GHOST_ALPHA)
    expect(alpha(out, 1)).toBe(Math.round(GHOST_ALPHA * weightBrightness(0.5)))
    expect(alpha(out, 2)).toBe(Math.round(GHOST_ALPHA * MIN_BRIGHTNESS)) // still visible
    expect(alpha(out, 2)).toBeGreaterThan(0)
    expect(alpha(out, 0)).toBeGreaterThan(alpha(out, 1))
    expect(alpha(out, 1)).toBeGreaterThan(alpha(out, 2))
  })

  it('weight dimming and the respawn fade multiply', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0], [0.5]), 1, null, false)
    const half = alpha(s.tick(FADE_MS / 2), 0)
    const full = alpha(s.tick(FADE_MS * 2), 0)
    expect(half).toBeLessThan(full)
    expect(full).toBe(Math.round(GHOST_ALPHA * weightBrightness(0.5)))
  })

  it('colours ghosts warm amber and never cyan', () => {
    const s = new GhostSmoother()
    s.onFrame(-2000, frame([0]), 1, null, false)
    const out = s.tick(0)
    const [r, g, b] = [out.col[0], out.col[1], out.col[2]]
    expect([r, g, b]).toEqual([...GHOST_RGB_LINEAR])
    expect(r).toBeGreaterThan(g) // red-dominant: warm
    expect(g).toBeGreaterThan(b)
    expect(b).toBeLessThan(r) // cyan would have blue >= red
    // the displayed (sRGB) colour is also warm, whichever space we look in
    expect(GHOST_RGB[0]).toBeGreaterThan(GHOST_RGB[2])
  })

  it('converts sRGB to linear light the standard way', () => {
    expect(srgbToLinear(0)).toBe(0)
    expect(srgbToLinear(255)).toBe(255)
    expect(srgbToLinear(128)).toBe(55) // mid-grey is ~21.6% linear
    expect(GHOST_RGB_LINEAR).toEqual([255, 111, 13])
  })
})

describe('weightBrightness', () => {
  it('maps 0..1 onto MIN_BRIGHTNESS..1 and survives bad input', () => {
    expect(weightBrightness(1)).toBe(1)
    expect(weightBrightness(0)).toBe(MIN_BRIGHTNESS)
    expect(weightBrightness(2)).toBe(1)
    expect(weightBrightness(-1)).toBe(MIN_BRIGHTNESS)
    expect(weightBrightness(Number.NaN)).toBe(1)
  })
})
