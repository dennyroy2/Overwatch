import { describe, expect, it } from 'vitest'
import { DISSOLVE_MS, Dissolve } from './dissolve'

const RGB = [255, 111, 13] as const
const make = () => new Dissolve(RGB)

describe('Dissolve', () => {
  it('starts exactly as bright and as big as the ghost was, and ends at nothing', () => {
    const d = make()
    d.capture(0, 1, 2, 3, 200, 1000)
    const start = d.tick(1000, 20, 3)
    expect(start.count).toBe(1)
    expect(Array.from(start.pos.slice(0, 3))).toEqual([1, 2, 3])
    expect(Array.from(start.col.slice(0, 4))).toEqual([255, 111, 13, 200])
    expect(start.haloRadius[0]).toBeCloseTo(20)
    expect(start.coreRadius[0]).toBeCloseTo(3)
    const near = d.tick(1000 + DISSOLVE_MS - 1, 20, 3)
    expect(near.col[3]).toBeLessThan(2)
    expect(near.haloRadius[0]).toBeLessThan(0.1)
    expect(d.tick(1000 + DISSOLVE_MS, 20, 3).count).toBe(0) // gone, and its slot is free
  })

  it('fades and shrinks together, smoothly, never getting brighter or bigger', () => {
    const d = make()
    d.capture(0, 0, 0, 0, 255, 0)
    let lastA = 256, lastR = Infinity
    for (let t = 0; t < DISSOLVE_MS; t += 25) {
      const o = d.tick(t, 30, 4)
      expect(o.col[3]).toBeLessThanOrEqual(lastA)
      expect(o.haloRadius[0]).toBeLessThanOrEqual(lastR)
      lastA = o.col[3]
      lastR = o.haloRadius[0]
    }
    const half = d.tick(DISSOLVE_MS / 2, 30, 4)
    expect(half.col[3]).toBeGreaterThan(100) // about half way, not already gone
    expect(half.col[3]).toBeLessThan(160)
  })

  it('draws only the dying ones, packed together, whichever slots they were in', () => {
    const d = make()
    d.capture(5, 50, 0, 0, 255, 0)
    d.capture(900, 900, 0, 0, 255, 0)
    const o = d.tick(10, 10, 2)
    expect(o.count).toBe(2)
    expect(o.pos[0]).toBe(50)
    expect(o.pos[3]).toBe(900)
    expect(d.active).toBe(2)
  })

  it('ignores a ghost that was not visible, a bad slot, and everything when switched off', () => {
    const d = make()
    d.capture(0, 0, 0, 0, 0, 0)
    d.capture(-1, 0, 0, 0, 255, 0)
    expect(d.tick(10, 10, 2).count).toBe(0)
    d.durationMs = 0 // reduced motion: ghosts just go
    d.capture(1, 0, 0, 0, 255, 0)
    expect(d.tick(10, 10, 2).count).toBe(0)
  })

  it('a slot replaced again starts over from the newer ghost; growing keeps the earlier ones', () => {
    const d = make()
    d.capture(0, 1, 0, 0, 255, 0)
    d.capture(0, 7, 0, 0, 255, 400)
    const o = d.tick(400, 10, 2)
    expect(o.count).toBe(1)
    expect(o.pos[0]).toBe(7)
    d.capture(20_000, 2, 0, 0, 255, 400) // far beyond the first capacity
    expect(d.tick(401, 10, 2).count).toBe(2)
  })

  it('can be slowed for watching, and reset', () => {
    const d = make()
    d.durationMs = DISSOLVE_MS * 8
    d.capture(0, 0, 0, 0, 255, 0)
    expect(d.tick(DISSOLVE_MS * 4, 10, 2).count).toBe(1) // still dissolving at 4x the normal time
    d.reset()
    expect(d.tick(1, 10, 2).count).toBe(0)
  })
})
