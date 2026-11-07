import { describe, expect, it } from 'vitest'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import { History, KEYFRAME_MS, MAX_KEYFRAMES, type FrameInfo } from './history'

/** A frame whose slot i is at longitude xs[i] (ghostBuffer layout). */
function frame(arrivalMs: number, xs: number[], over: Partial<FrameInfo> = {}): FrameInfo {
  const cur = new Float32Array(xs.length * FLOATS_PER_GHOST)
  xs.forEach((x, i) => {
    cur[i * FLOATS_PER_GHOST + OFFSET.longitude] = x
    cur[i * FLOATS_PER_GHOST + OFFSET.latitude] = 53.5
    cur[i * FLOATS_PER_GHOST + OFFSET.weight] = 1
  })
  return { arrivalMs, cur, count: xs.length, allRespawned: false, wasRespawned: () => false, simTime: arrivalMs * 100, clusters: [], alive: 1, ...over }
}

describe('History', () => {
  it('records one keyframe per KEYFRAME_MS, however fast frames arrive', () => {
    const h = new History()
    for (let t = 0; t <= 3000; t += 200) h.onFrame(frame(1000 + t, [t]))
    expect(h.keyframes.map((k) => k.t)).toEqual([0, 1000, 2000, 3000])
    expect(h.keyframes[1].pos[0]).toBe(1000) // the frame at 1000 ms into the case
  })

  it('stores only [lon, lat, elevation] plus a weight byte per ghost', () => {
    const h = new History()
    h.onFrame(frame(0, [10, 20, 30]))
    const k = h.keyframes[0]
    expect(k.pos.length).toBe(9)
    expect(k.weight.length).toBe(3)
    expect(k.weight[0]).toBe(255)
    expect(h.approxBytes).toBe(9 * 4 + 3)
  })

  it('marks the first keyframe as an all-new swarm', () => {
    const h = new History()
    h.onFrame(frame(0, [1, 2]))
    expect(h.keyframes[0].respawned).toBe('all')
  })

  it('keeps respawns from frames BETWEEN keyframes (none are lost)', () => {
    const h = new History()
    h.onFrame(frame(0, [0, 0, 0]))
    h.onFrame(frame(400, [0, 0, 0], { wasRespawned: (i) => i === 2 })) // a respawn at a non-keyframe frame
    h.onFrame(frame(1000, [0, 0, 0]))
    const r = h.keyframes[1].respawned
    expect(r).toBeInstanceOf(Uint8Array)
    expect(Array.from(r as Uint8Array)).toEqual([0, 0, 1])
    h.onFrame(frame(2000, [0, 0, 0])) // nothing respawned since: no flags
    expect(h.keyframes[2].respawned).toBeNull()
  })

  it('records "all" when every slot respawned (the fallback after evidence)', () => {
    const h = new History()
    h.onFrame(frame(0, [0, 0]))
    h.onFrame(frame(600, [0, 0], { allRespawned: true }))
    h.onFrame(frame(1000, [0, 0]))
    expect(h.keyframes[1].respawned).toBe('all')
  })

  it('caps the recording and drops the oldest keyframes', () => {
    const h = new History()
    for (let k = 0; k < MAX_KEYFRAMES + 5; k++) h.onFrame(frame(k * KEYFRAME_MS, [k]))
    expect(h.keyframes.length).toBe(MAX_KEYFRAMES)
    expect(h.startT).toBe(5 * KEYFRAME_MS)
  })

  it('starts over when the swarm size changes or the case closes', () => {
    const h = new History()
    h.onFrame(frame(0, [1, 2]))
    h.onFrame(frame(1000, [1, 2]))
    h.onFrame(frame(5000, [1, 2, 3])) // a different case
    expect(h.keyframes.length).toBe(1)
    expect(h.epoch).toBe(5000)
    h.onFrame(frame(6000, [], { count: 0 }))
    expect(h.isEmpty).toBe(true)
    expect(h.epoch).toBeNull()
  })

  it('notes evidence ticks relative to the first frame', () => {
    const h = new History()
    h.noteEvent(500, 'evidence') // before any frame: ignored
    h.onFrame(frame(1000, [1]))
    h.noteEvent(3500, 'evidence')
    h.noteEvent(4000, 'tasking')
    expect(h.events).toEqual([{ t: 2500, kind: 'evidence' }, { t: 3000, kind: 'tasking' }])
  })

  it('inserts an exact snapshot, ignores one that is not newer, and delays the next keyframe by a full second', () => {
    const h = new History()
    h.onFrame(frame(0, [0, 0]))
    h.onFrame(frame(1000, [10, 10]))
    const drawn = Float32Array.of(5, 53.5, 0, 6, 53.5, 0)
    const w = new Float32Array(2 * FLOATS_PER_GHOST).fill(1)
    h.insertSnapshot(1400, drawn, 2, w, 123, [], 1)
    expect(h.keyframes.map((k) => k.t)).toEqual([0, 1000, 1400])
    expect(Array.from(h.keyframes[2].pos)).toEqual([5, 53.5, 0, 6, 53.5, 0])
    h.insertSnapshot(1400, drawn, 2, w, 123, [], 1) // same time: ignored
    expect(h.keyframes.length).toBe(3)
    h.onFrame(frame(2000, [20, 20])) // only 600 ms after the snapshot: no new keyframe
    expect(h.keyframes.length).toBe(3)
    h.onFrame(frame(2400, [24, 24])) // a full second after it
    expect(h.keyframes.length).toBe(4)
  })

  it('liveT is "now" relative to the first frame', () => {
    const h = new History()
    expect(h.liveT(5000)).toBe(0)
    h.onFrame(frame(1000, [1]))
    expect(h.liveT(4500)).toBe(3500)
  })

  it('remembers when each id was FIRST seen; an upsert of the same id is not a new tick', () => {
    const h = new History()
    h.onFrame(frame(0, [1]))
    h.noteEvent(2000, 'evidence', 'ev_a')
    h.noteEvent(5000, 'evidence', 'ev_a') // the note is structured and re-sent with the same id
    h.noteEvent(6000, 'tasking', 'req_1')
    expect(h.firstSeen.get('ev_a')).toBe(2000)
    expect(h.firstSeen.get('req_1')).toBe(6000)
    expect(h.events.map((e) => e.id)).toEqual(['ev_a', 'req_1'])
    h.reset()
    expect(h.firstSeen.size).toBe(0)
  })
})
