import { describe, expect, it } from 'vitest'
import { DISSOLVE_MS } from './dissolve'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import { FADE_MS, GHOST_ALPHA, GhostSmoother, MIN_BRIGHTNESS, weightBrightness } from './smoother'

function frame(xs: number[], weights?: number[]): Float32Array {
  const buf = new Float32Array(xs.length * FLOATS_PER_GHOST)
  xs.forEach((x, i) => {
    buf[i * FLOATS_PER_GHOST + OFFSET.longitude] = x
    buf[i * FLOATS_PER_GHOST + OFFSET.weight] = weights ? weights[i] : 1
  })
  return buf
}

/** A swarm that has been running a while, so the start fade-in is over. */
function running(xs: number[], weights?: number[]): GhostSmoother {
  const s = new GhostSmoother()
  s.onFrame(-5000, frame(xs, weights), xs.length, null, false)
  s.onFrame(0, frame(xs, weights), xs.length, null, false)
  return s
}

describe('GhostSmoother: dissolving the ghosts that were replaced', () => {
  it('keeps the dead ghost where it was DRAWN (mid-glide), at the brightness it had', () => {
    const s = running([0, 100])
    s.onFrame(200, frame([10, 100]), 2, null, false) // slot 0 glides 0 -> 10 over the next 200 ms
    const drawn = s.tick(300).pos[0] // what the screen shows at this moment, part-way along
    expect(drawn).toBeGreaterThan(1)
    expect(drawn).toBeLessThan(9)
    s.onFrame(300, frame([20, 100]), 2, Int32Array.of(0), false) // slot 0 died here: the new ghost is at 20
    const d = s.dissolve.tick(300, 10, 2)
    expect(d.count).toBe(1)
    expect(d.pos[0]).toBeCloseTo(drawn, 4) // exactly where the screen showed it: not 10 (the last data frame), not 20 (the replacement)
    expect(d.col[3]).toBe(GHOST_ALPHA)
    const live = s.tick(300)
    expect(live.pos[0]).toBeCloseTo(20, 5) // the new ghost is drawn at once, at its own place
    expect(live.col[3]).toBe(0) // and is still invisible: it fades in while the old one fades out
  })

  it('only the replaced slots dissolve', () => {
    const s = running([0, 100, 200, 300])
    s.onFrame(200, frame([0, 100, 200, 300]), 4, Int32Array.of(1, 3), false)
    expect(s.dissolve.tick(200, 10, 2).count).toBe(2)
  })

  it('the dying ghost leaves while the new one arrives: out over 600 ms, in over 300 ms', () => {
    const s = running([0])
    s.onFrame(200, frame([50]), 1, Int32Array.of(0), false)
    expect(s.dissolve.tick(200 + FADE_MS, 10, 2).col[3]).toBeGreaterThan(0) // new ghost fully in, old one still fading
    expect(s.tick(200 + FADE_MS).col[3]).toBe(GHOST_ALPHA)
    expect(s.dissolve.tick(200 + DISSOLVE_MS, 10, 2).count).toBe(0)
  })

  it('a ghost still fading in, or a dim unlikely one, dissolves from the brightness it actually had', () => {
    const s = running([0, 100], [1, 0])
    s.onFrame(200, frame([0, 100], [1, 0]), 2, Int32Array.of(0, 1), false)
    const d = s.dissolve.tick(200, 10, 2)
    expect(d.col[3]).toBe(GHOST_ALPHA) // fully visible
    expect(d.col[7]).toBe(Math.round(GHOST_ALPHA * weightBrightness(0))) // the weight-0 ghost was dim
    expect(d.col[7]).toBe(Math.round(GHOST_ALPHA * MIN_BRIGHTNESS))
    const fresh = new GhostSmoother()
    fresh.onFrame(0, frame([0]), 1, null, false)
    fresh.onFrame(200, frame([0]), 1, null, false) // still fading in from the case start
    fresh.onFrame(250, frame([0]), 1, Int32Array.of(0), false)
    expect(fresh.dissolve.tick(250, 10, 2).count).toBe(1)
    expect(fresh.dissolve.tick(250, 10, 2).col[3]).toBeLessThan(GHOST_ALPHA)
  })

  it('a brand-new swarm, or a different size of swarm, has nothing to dissolve', () => {
    const s = new GhostSmoother()
    s.onFrame(0, frame([0, 1, 2]), 3, null, false)
    expect(s.dissolve.tick(0, 10, 2).count).toBe(0)
    s.onFrame(200, frame([0, 1]), 2, null, false) // the count changed: a new swarm
    expect(s.dissolve.tick(200, 10, 2).count).toBe(0)
  })

  it('when the whole swarm is resampled (the fallback without a respawned list) the old swarm dissolves', () => {
    const s = running([0, 100, 200])
    s.onFrame(200, frame([5, 105, 205]), 3, null, true)
    expect(s.dissolve.tick(200, 10, 2).count).toBe(3)
  })

  it('can be slowed down for watching, and switched off for reduced motion', () => {
    const s = running([0])
    s.configure({ slowmo: 8 })
    s.onFrame(200, frame([9]), 1, Int32Array.of(0), false)
    expect(s.dissolve.tick(200 + DISSOLVE_MS * 4, 10, 2).count).toBe(1)
    expect(s.tick(200 + FADE_MS * 4).col[3]).toBeLessThan(GHOST_ALPHA) // the fade-in slows down with it
    const calm = running([0])
    calm.configure({ reducedMotion: true })
    calm.onFrame(200, frame([9]), 1, Int32Array.of(0), false)
    expect(calm.dissolve.tick(200, 10, 2).count).toBe(0)
  })

  it('a case that is closed forgets its dying ghosts', () => {
    const s = running([0])
    s.onFrame(200, frame([9]), 1, Int32Array.of(0), false)
    s.onFrame(250, new Float32Array(0), 0, null, false) // count 0: closed
    expect(s.dissolve.tick(250, 10, 2).count).toBe(0)
  })
})
