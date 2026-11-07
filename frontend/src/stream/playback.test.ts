import { describe, expect, it } from 'vitest'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import { History } from './history'
import { Playback, type LiveCapture } from './playback'

function filled(seconds: number): History {
  const h = new History()
  for (let s = 0; s <= seconds; s++) {
    const cur = new Float32Array(2 * FLOATS_PER_GHOST)
    cur[OFFSET.longitude] = s
    cur[FLOATS_PER_GHOST + OFFSET.longitude] = s + 100
    h.onFrame({ arrivalMs: 1000 + s * 1000, cur, count: 2, allRespawned: false, wasRespawned: () => false, simTime: s, clusters: [], alive: 1 })
  }
  return h
}
// the case started at t = 1000 ms on the wall clock, and `seconds` have been recorded: live edge = now - 1000
const NOW = (s: number) => 1000 + s * 1000

describe('Playback', () => {
  it('starts live and pausing freezes the live edge; the frozen picture is an exact snapshot of the screen', () => {
    const h = filled(10)
    const pb = new Playback(h)
    const cap: LiveCapture = { drawn: Float32Array.of(7.5, 0, 0, 107.5, 0, 0), count: 2, weights: new Float32Array(2 * FLOATS_PER_GHOST).fill(1), simTime: 99, clusters: [], alive: 1 }
    pb.setCapture(() => cap)
    expect(pb.isLive).toBe(true)
    pb.pause(NOW(10.4))
    expect(pb.mode).toBe('paused')
    expect(pb.T).toBeCloseTo(10400, 3)
    const snap = h.keyframes.at(-1)!
    expect(snap.t).toBeCloseTo(10400, 3)
    expect(snap.pos[0]).toBe(7.5) // the exact drawn position, not a keyframe up to a second old
  })

  it('pausing again, or with nothing recorded, changes nothing', () => {
    const empty = new Playback(new History())
    empty.pause(0)
    expect(empty.mode).toBe('live')
    const pb = new Playback(filled(5))
    pb.pause(NOW(5))
    const T = pb.T
    pb.pause(NOW(6)) // already paused: stays where it is
    expect(pb.T).toBe(T)
  })

  it('play from the past replays at normal speed and shows how far behind live it is', () => {
    const pb = new Playback(filled(20))
    pb.seek(4000, NOW(20))
    expect(pb.mode).toBe('paused')
    expect(pb.T).toBe(4000)
    pb.play(NOW(20))
    expect(pb.mode).toBe('playing')
    for (let t = 20; t < 20.5; t += 1 / 60) pb.advance(NOW(t)) // ~0.5 s of 60 fps frames
    expect(pb.T).toBeGreaterThan(4450)
    expect(pb.T).toBeLessThan(4550)
    expect(pb.behindMs(NOW(20.5))).toBeCloseTo(20500 - pb.T, 0)
  })

  it('stays behind live while playing (the recording keeps growing), until you go live', () => {
    const pb = new Playback(filled(20))
    pb.seek(18000, NOW(20))
    pb.play(NOW(20))
    for (let s = 20; s < 26; s += 0.5) pb.advance(NOW(s))
    expect(pb.mode).toBe('playing')
    expect(pb.behindMs(NOW(26))).toBeGreaterThan(1500)
    pb.goLive()
    expect(pb.mode).toBe('live')
  })

  it('play at the live edge, or seeking to it, goes live', () => {
    const pb = new Playback(filled(10))
    pb.pause(NOW(10))
    pb.play(NOW(10.1)) // paused at the edge: nothing to replay
    expect(pb.mode).toBe('live')
    pb.seek(3000, NOW(10))
    expect(pb.mode).toBe('paused')
    pb.seek(10000, NOW(10)) // dragged to the right-hand end
    expect(pb.mode).toBe('live')
  })

  it('seek clamps to the recording, and from live it pauses at that time', () => {
    const pb = new Playback(filled(10))
    pb.seek(-5000, NOW(10))
    expect(pb.T).toBe(0)
    expect(pb.mode).toBe('paused')
    pb.seek(2500, NOW(10))
    expect(pb.T).toBe(2500)
  })

  it('time stands still while the thumb is being dragged', () => {
    const pb = new Playback(filled(20))
    pb.seek(5000, NOW(20))
    pb.play(NOW(20))
    pb.advance(NOW(20))
    pb.scrubbing = true
    pb.advance(NOW(21))
    expect(pb.T).toBe(5000)
    pb.scrubbing = false
    pb.advance(NOW(21.1))
    expect(pb.T).toBeGreaterThan(5000)
  })

  it('a stalled tab cannot make replay leap forward', () => {
    const pb = new Playback(filled(60))
    pb.seek(5000, NOW(60))
    pb.play(NOW(60))
    pb.advance(NOW(60))
    pb.advance(NOW(90)) // 30 s with no frames
    expect(pb.T).toBeLessThanOrEqual(5250)
  })

  it('toggle pauses from live and plays from paused', () => {
    const pb = new Playback(filled(20))
    pb.toggle(NOW(20))
    expect(pb.mode).toBe('paused')
    pb.seek(5000, NOW(20))
    pb.toggle(NOW(20))
    expect(pb.mode).toBe('playing')
    pb.toggle(NOW(20.1))
    expect(pb.mode).toBe('paused')
  })

  it('notifies listeners on changes and bumps the version', () => {
    const pb = new Playback(filled(10))
    let n = 0
    const off = pb.onChange(() => { n += 1 })
    const v = pb.version
    pb.pause(NOW(10))
    pb.seek(2000, NOW(10))
    expect(n).toBe(2)
    expect(pb.version).toBeGreaterThan(v)
    off()
    pb.goLive()
    expect(n).toBe(2)
  })

  it('reset returns to live', () => {
    const pb = new Playback(filled(10))
    pb.seek(2000, NOW(10))
    pb.reset()
    expect(pb.mode).toBe('live')
    expect(pb.scrubbing).toBe(false)
  })
})
