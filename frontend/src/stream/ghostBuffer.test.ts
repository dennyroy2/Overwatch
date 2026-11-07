import { beforeEach, describe, expect, it } from 'vitest'
import { currentBuffer, ghosts, noteEvidence, onGhostFrame, previousBuffer, pushFrame, readRespawned, resetGhosts } from './ghostBuffer'

const T = '2026-01-01T00:00:00Z'

describe('ghost buffer', () => {
  beforeEach(resetGhosts)

  it('writes [lon, lat, weight] per slot and swaps buffers each frame', () => {
    pushFrame([[-113.5, 53.5, 1], [-113.4, 53.6, 0.5]], T, undefined)
    const first = currentBuffer()
    expect(Array.from(first.slice(0, 8))).toEqual([expect.closeTo(-113.5, 4), expect.closeTo(53.5, 4), 0, 1, expect.closeTo(-113.4, 4), expect.closeTo(53.6, 4), 0, 0.5])
    pushFrame([[-113.0, 53.0, 1]], T, undefined)
    expect(currentBuffer()).not.toBe(first)
    expect(previousBuffer()).toBe(first)
    expect(ghosts.count).toBe(1)
    expect(ghosts.prevCount).toBe(2)
    expect(ghosts.frame).toBe(2)
  })

  it('missing respawned after evidence means every slot respawned (fallback)', () => {
    pushFrame([[0, 0, 1]], T, undefined)
    expect(ghosts.allRespawned).toBe(false)
    noteEvidence()
    pushFrame([[0, 0, 1]], T, undefined)
    expect(ghosts.allRespawned).toBe(true)
    pushFrame([[0, 0, 1]], T, undefined) // only the first frame after evidence
    expect(ghosts.allRespawned).toBe(false)
  })

  it('uses the respawned list when the backend sends it', () => {
    noteEvidence()
    pushFrame([[0, 0, 1], [1, 1, 1], [2, 2, 1]], T, [1])
    expect(ghosts.allRespawned).toBe(false)
    expect(Array.from(ghosts.respawned ?? [])).toEqual([1])
  })

  it('grows past the initial capacity without dropping the new frame', () => {
    const n = 20_000
    pushFrame(Array.from({ length: n }, (_, i) => [i, i, 1]), T, undefined)
    expect(ghosts.count).toBe(n)
    expect(currentBuffer()[4 * (n - 1)]).toBe(n - 1)
  })

  it('reads respawned defensively', () => {
    expect(readRespawned({})).toBeUndefined()
    expect(readRespawned({ respawned: [3, 4] })).toEqual([3, 4])
    expect(readRespawned({ respawned: 'x' })).toBeUndefined()
  })

  it('notifies frame listeners and stops after unsubscribe', () => {
    let n = 0
    const off = onGhostFrame(() => { n += 1 })
    pushFrame([[0, 0, 1]], T, undefined)
    pushFrame([[0, 0, 1]], T, undefined)
    off()
    pushFrame([[0, 0, 1]], T, undefined)
    expect(n).toBe(2)
  })
})
