import { describe, expect, it } from 'vitest'
import { areaCentre, constraintRows, decisionFor, gainPercent, gainSentence, splitRequests, targetRing, type Request } from './tasking'

const req = (over: Partial<Request> = {}): Request => ({
  id: 'r1', case_id: 'c', asset: 'Drone 2', target_area: [], route: [], expected_gain: 0.23, duration_min: 12,
  reasons: [], status: 'pending', ...over,
})

describe('gain', () => {
  it('is a whole percent clamped to 0..100, and a sentence the officer can read', () => {
    expect(gainPercent(req({ expected_gain: 0.234 }))).toBe(23)
    expect(gainPercent(req({ expected_gain: 1.7 }))).toBe(100)
    expect(gainPercent(req({ expected_gain: -1 }))).toBe(0)
    expect(gainPercent(req({ expected_gain: Number.NaN }))).toBe(0)
    expect(gainSentence(req())).toBe('covers 23% of remaining probability in 12 min')
  })
})

describe('constraintRows', () => {
  it('always shows the four checks, and an unreported one is unknown, never passed', () => {
    const rows = constraintRows(req({ constraints_ok: { battery: true, wind: false } }))
    expect(rows.map((r) => `${r.key}:${r.state}`)).toEqual(['battery:ok', 'line_of_sight:unknown', 'airspace:unknown', 'wind:fail'])
    expect(constraintRows(req()).every((r) => r.state === 'unknown')).toBe(true)
  })
})

describe('target area', () => {
  const box = [{ lat: 1, lon: 1 }, { lat: 1, lon: 3 }, { lat: 3, lon: 3 }, { lat: 3, lon: 1 }]
  it('closes the ring in [lon, lat] order, and needs at least three points', () => {
    const ring = targetRing({ target_area: box })
    expect(ring).toHaveLength(5)
    expect(ring?.[0]).toEqual([1, 1])
    expect(ring?.[1]).toEqual([3, 1])
    expect(ring?.[4]).toEqual(ring?.[0])
    expect(targetRing({ target_area: box.slice(0, 2) })).toBeNull()
  })
  it('centres on the average of the corners', () => {
    expect(areaCentre({ target_area: box })).toEqual({ lat: 2, lon: 2 })
    expect(areaCentre({ target_area: [] })).toBeNull()
  })
})

describe('splitRequests', () => {
  it('puts pending first, newest on top, and decided after', () => {
    const byId = {
      a: req({ id: 'a', status: 'approved' }), b: req({ id: 'b' }), c: req({ id: 'c', status: 'rejected' }), d: req({ id: 'd' }),
    }
    expect(splitRequests(['a', 'b', 'c', 'd'], byId)).toEqual({ pending: ['d', 'b'], decided: ['c', 'a'] })
  })
  it('hides what replay says had not arrived, and tolerates ids missing from the map', () => {
    const byId = { a: req({ id: 'a' }), b: req({ id: 'b' }) }
    expect(splitRequests(['a', 'b', 'zz'], byId, (id) => id !== 'b')).toEqual({ pending: ['a'], decided: [] })
  })
})

describe('splitRequests with the stream-derived state', () => {
  it('counts a decision that is still being confirmed as waiting, and a confirmed one as decided', () => {
    const byId = { a: req({ id: 'a' }), b: req({ id: 'b' }), c: req({ id: 'c' }) }
    const st: Record<string, 'sending' | 'approved' | 'pending'> = { a: 'sending', b: 'approved', c: 'pending' }
    expect(splitRequests(['a', 'b', 'c'], byId, () => true, (r) => st[r.id])).toEqual({ pending: ['c', 'a'], decided: ['b'] })
  })
})

describe('decisionFor', () => {
  const log = [
    { time: '2026-01-01T10:00:00Z', actor: 'system', action: 'note', detail: 'x' },
    { time: '2026-01-01T10:05:00Z', actor: 'Officer Lee', action: 'decision', detail: 'Drone 2: approved' },
    { time: '2026-01-01T10:06:00Z', actor: 'Officer Lee', action: 'decision', detail: 'Ground Team 1: rejected (already searched)' },
  ]
  it('finds who decided and why, by asset and status', () => {
    expect(decisionFor(log, { asset: 'Drone 2', status: 'approved' })).toEqual({ who: 'Officer Lee', time: '2026-01-01T10:05:00Z', reason: null })
    expect(decisionFor(log, { asset: 'Ground Team 1', status: 'rejected' })?.reason).toBe('already searched')
    expect(decisionFor(log, { asset: 'Drone 9', status: 'approved' })).toBeNull()
  })
})
