import { describe, expect, it } from 'vitest'
import { Attribution, DIM_RATIO } from './attribution'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import type { Kills } from './smoother'

/** A ghostBuffer-layout frame: slot i at longitude xs[i], latitude 10 + i, weight ws[i] (default 1). */
function frame(xs: number[], ws?: number[]): Float32Array {
  const b = new Float32Array(xs.length * FLOATS_PER_GHOST)
  xs.forEach((x, i) => {
    b[i * FLOATS_PER_GHOST + OFFSET.longitude] = x
    b[i * FLOATS_PER_GHOST + OFFSET.latitude] = 10 + i
    b[i * FLOATS_PER_GHOST + OFFSET.weight] = ws ? ws[i] : 1
  })
  return b
}
/** Kills at the given slots, each drawn at (100 + slot, -slot, 0). */
function kills(...slots: number[]): Kills {
  return { count: slots.length, slots: Int32Array.from(slots), pos: Float32Array.from(slots.flatMap((s) => [100 + s, -s, 0])) }
}
const lons = (a: Float32Array) => Array.from({ length: a.length / 3 }, (_, i) => a[i * 3])

describe('Attribution: replaced ghosts', () => {
  const ghosts = frame([0, 1, 2, 3, 4])

  it('credits replacements to the most recent evidence and remembers where each ghost was drawn', () => {
    const a = new Attribution()
    a.noteEvidence('ev1', 'sighting', 5, ghosts)
    a.onKills(kills(1, 3))
    a.onKills(kills(4)) // a later frame, same window
    const s = a.snapshot('ev1', 5, ghosts)!
    expect(s.killedCount).toBe(3)
    expect(s.removedCount).toBe(3)
    expect(lons(s.removed)).toEqual([101, 103, 104]) // where they were drawn when they died
    expect(s.open).toBe(true)
  })

  it('sorts the swarm into removed, stayed and arrived: the new ghosts in replaced slots are "arrived"', () => {
    const a = new Attribution()
    a.noteEvidence('ev1', 'sighting', 5, ghosts)
    a.onKills(kills(1, 3))
    const now = frame([0, 50, 2, 60, 4]) // slots 1 and 3 now hold new ghosts, near the sighting
    const s = a.snapshot('ev1', 5, now)!
    expect(lons(s.arrived)).toEqual([50, 60])
    expect(lons(s.stayed)).toEqual([0, 2, 4])
    expect(s.stayedCount + s.arrivedCount).toBe(5) // every ghost is in exactly one of them
  })

  it('a new evidence item closes the window; its picture is then frozen as the next card arrived', () => {
    const a = new Attribution()
    a.noteEvidence('ev1', 'sighting', 5, ghosts)
    a.onKills(kills(1, 3))
    const moved = frame([0, 9, 20, 9, 40])
    a.noteEvidence('ev2', 'searched_area', 5, moved)
    a.onKills(kills(0)) // credited to ev2, not ev1
    const s1 = a.snapshot('ev1', 5, frame([99, 99, 99, 99, 99]))! // the swarm now is irrelevant to a closed window
    expect(s1.open).toBe(false)
    expect(s1.killedCount).toBe(2)
    expect(lons(s1.stayed)).toEqual([0, 20, 40])
    expect(lons(s1.arrived)).toEqual([9, 9])
    expect(a.snapshot('ev2', 5, moved)!.killedCount).toBe(1)
  })
})

describe('Attribution: dimmed ghosts (the searched-area case)', () => {
  it('a ghost whose weight the card turned down by 40% or more counts as removed, where it was when the card arrived', () => {
    const a = new Attribution()
    a.noteEvidence('search', 'searched_area', 4, frame([0, 1, 2, 3], [1, 1, 1, 1]))
    const after = frame([0.5, 1.5, 2.5, 3.5], [1, 0.37, 0.37, 0.9]) // two inside the area were dimmed, one barely
    const s = a.snapshot('search', 4, after)!
    expect(s.killedCount).toBe(0) // nothing was replaced...
    expect(s.dimmedCount).toBe(2) // ...but the hole is there
    expect(s.removedCount).toBe(2)
    expect(lons(s.removed)).toEqual([1, 2]) // at their positions when the card arrived, not where they drifted to
    expect(lons(s.stayed)).toEqual([0.5, 3.5])
    expect(s.arrivedCount).toBe(0)
  })

  it('the 40% line: a drop to exactly the ratio is kept, below it is removed; a ghost that was already near-weightless is not credited', () => {
    const a = new Attribution()
    a.noteEvidence('c', 'clue', 3, frame([0, 1, 2], [1, 1, 0.1]))
    const s = a.snapshot('c', 3, frame([0, 1, 2], [DIM_RATIO + 0.001, DIM_RATIO - 0.001, 0.001]))!
    expect(s.dimmedCount).toBe(1)
    expect(lons(s.removed)).toEqual([1])
  })

  it('a resample that resets every weight to 1 dims nobody; a replaced ghost is never counted twice', () => {
    const a = new Attribution()
    a.noteEvidence('e', 'sighting', 3, frame([0, 1, 2], [1, 0.5, 0.3]))
    a.onKills(kills(1))
    const s = a.snapshot('e', 3, frame([0, 7, 2], [1, 0.1, 1]))! // slot 1 was replaced; its new weight is irrelevant
    expect(s.killedCount).toBe(1)
    expect(s.dimmedCount).toBe(0)
    expect(s.removedCount).toBe(1)
  })

  it('the dimming is frozen when the window closes, and a swarm of a different size is not compared', () => {
    const a = new Attribution()
    a.noteEvidence('s', 'searched_area', 3, frame([0, 1, 2]))
    a.noteEvidence('next', 'clue', 3, frame([0, 1, 2], [1, 0.2, 1])) // closes `s`: slot 1 dimmed
    expect(a.snapshot('s', 3, frame([9, 9, 9]))!.dimmedCount).toBe(1)
    const b = new Attribution()
    b.noteEvidence('s', 'searched_area', 3, frame([0, 1, 2]))
    expect(b.snapshot('s', 5, frame([0, 1, 2, 3, 4], [0.1, 0.1, 0.1, 0.1, 0.1]))!.dimmedCount).toBe(0)
  })
})

describe('Attribution: bookkeeping', () => {
  const ghosts = frame([0, 1, 2, 3, 4])

  it('a plain note opens no window; the same id arriving again as a structured card does', () => {
    const a = new Attribution()
    a.noteEvidence('tip', 'note', 5, ghosts)
    a.onKills(kills(2)) // nobody's: no window is open
    expect(a.has('tip')).toBe(false)
    a.noteEvidence('tip', 'sighting', 5, ghosts)
    a.onKills(kills(2))
    expect(a.snapshot('tip', 5, ghosts)!.killedCount).toBe(1)
  })

  it('the same id arriving again while its window is open continues it', () => {
    const a = new Attribution()
    a.noteEvidence('ev1', 'sighting', 5, ghosts)
    a.onKills(kills(1))
    a.noteEvidence('ev1', 'sighting', 5, ghosts)
    a.onKills(kills(2))
    expect(a.snapshot('ev1', 5, ghosts)!.killedCount).toBe(2)
  })

  it('knows nothing about a card it never saw arrive, and forgets everything on reset', () => {
    const a = new Attribution()
    expect(a.snapshot('hydrated', 5, ghosts)).toBeNull()
    a.noteEvidence('ev1', 'clue', 5, ghosts)
    a.reset()
    expect(a.has('ev1')).toBe(false)
    a.onKills(kills(1))
    expect(a.snapshot('ev1', 5, ghosts)).toBeNull()
  })

  it('a card that changed nothing says so, and only the latest windows are kept on a very long case', () => {
    const a = new Attribution()
    a.noteEvidence('quiet', 'favourite_place', 5, ghosts)
    a.noteEvidence('next', 'clue', 5, ghosts)
    const q = a.snapshot('quiet', 5, ghosts)!
    expect(q.removedCount).toBe(0)
    expect(q.stayedCount).toBe(5)
    for (let i = 0; i < 120; i++) a.noteEvidence(`e${i}`, 'clue', 5, ghosts)
    expect(a.has('quiet')).toBe(false)
    expect(a.has('e119')).toBe(true)
  })

  it('handles a big event without losing or double counting a ghost', () => {
    const a = new Attribution()
    const n = 5000
    const xs = Array.from({ length: n }, (_, i) => i)
    a.noteEvidence('big', 'sighting', n, frame(xs))
    a.onKills(kills(...[...new Set(Array.from({ length: 3750 }, (_, i) => (i * 4) / 3 | 0))]))
    const s = a.snapshot('big', n, frame(xs))!
    expect(s.stayedCount + s.arrivedCount).toBe(n)
    expect(s.killedCount).toBe(s.arrivedCount)
  })
})
