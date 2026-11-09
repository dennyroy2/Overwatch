// A rolling recording of the swarm so the officer can pause, scrub back and replay (step 38, built early).
//
// The backend cannot be paused (the contract has no such call), so "pause" freezes what the SCREEN shows
// while this recorder keeps listening, like a live-TV recorder. Memory is the constraint: 10,000 ghosts at
// 5 frames a second would be hundreds of MB within minutes, so we keep ONE keyframe per second, and only
// [lon, lat, elevation] (3 floats) plus a 1-byte weight per ghost: ~130 KB per second at 10,000 ghosts,
// ~8 MB a minute, capped at MAX_KEYFRAMES (15 minutes, ~120 MB at 10,000 and ~60 MB at 5,000).
//
// Between keyframes we also remember WHICH slots were respawned (a new ghost, not a moved one), so a replay
// never glides a ghost across the map from its dead predecessor to its replacement.
//
// Times are milliseconds since the first frame of the case (`epoch`), like the trail timestamps.
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import type { Cluster } from '@/types'

/** One recorded frame per this many ms. */
export const KEYFRAME_MS = 1000
/** 15 minutes at one keyframe a second. Oldest keyframes are dropped beyond this. */
export const MAX_KEYFRAMES = 900

export interface Keyframe {
  /** ms since `epoch`. */
  t: number
  count: number
  /** [lon, lat, elevation] per slot. */
  pos: Float32Array
  /** Probability weight 0..1 quantised to a byte. */
  weight: Uint8Array
  /** Slots respawned since the previous keyframe: a per-slot flag array, 'all', or null for none. */
  respawned: Uint8Array | 'all' | null
  /** Simulation time of this frame (ms since the Unix epoch). */
  simTime: number
  clusters: readonly Cluster[]
  alive: number | null
}

export interface HistoryEvent {
  t: number
  kind: 'evidence' | 'tasking' | 'found'
  /** The evidence or request id, so cards and pins can follow the replay time. */
  id?: string
}

/** What the recorder needs to know about the frame that just arrived. */
export interface FrameInfo {
  arrivalMs: number
  /** ghostBuffer layout (stride 4), newest frame. */
  cur: Float32Array
  count: number
  /** True when every slot is new (the first frame, or the fallback after evidence). */
  allRespawned: boolean
  wasRespawned: (slot: number) => boolean
  simTime: number
  clusters: readonly Cluster[]
  alive: number | null
}

export class History {
  epoch: number | null = null
  keyframes: Keyframe[] = []
  events: HistoryEvent[] = []
  /** When each evidence/request id was FIRST seen, ms since epoch (an upsert later never moves it). */
  firstSeen = new Map<string, number>()
  /** When the stream first confirmed each request as approved or rejected (so a replay shows it pending before that). */
  decisions = new Map<string, { t: number; state: 'approved' | 'rejected' }>()
  /** When each kind of log entry first arrived ('search_closed', 'found_confirmed'...), ms since epoch. */
  logAt = new Map<string, number>()
  /** When the drone feed first opened, so a replay from before that has no feed on screen. */
  feedOpenedAt: number | undefined = undefined
  /** Set when the simulation was stopped: the live edge stays here (wall-clock ms) instead of growing. */
  haltedAt: number | null = null
  private count = 0
  private pendingFlags = new Uint8Array(0)
  private pendingAny = false
  private pendingAll = false
  private lastT = -Infinity

  reset(): void {
    this.epoch = null
    this.haltedAt = null
    this.keyframes = []
    this.events = []
    this.firstSeen = new Map()
    this.decisions = new Map()
    this.logAt = new Map()
    this.feedOpenedAt = undefined
    this.count = 0
    this.pendingAny = false
    this.pendingAll = false
    this.lastT = -Infinity
  }

  get isEmpty(): boolean {
    return this.keyframes.length === 0
  }

  /** Time of the first kept keyframe. */
  get startT(): number {
    return this.keyframes.length ? this.keyframes[0].t : 0
  }

  /** The live edge in history time: "now" relative to the first frame. */
  liveT(nowMs: number): number {
    return this.epoch === null ? 0 : (this.haltedAt ?? nowMs) - this.epoch
  }

  /** The simulation stopped: the time bar's end stops growing and the live picture stops moving. */
  halt(nowMs: number): void {
    if (this.epoch !== null && this.haltedAt === null) this.haltedAt = nowMs
  }

  onFrame(f: FrameInfo): void {
    if (f.count === 0) return this.reset()
    if (this.epoch === null || f.count !== this.count) {
      this.reset()
      this.epoch = f.arrivalMs
      this.count = f.count
      this.pendingFlags = new Uint8Array(f.count)
      this.pendingAll = true // the first frame is a brand-new swarm: it fades in
    }
    const rel = f.arrivalMs - (this.epoch as number)
    // Remember respawns from EVERY frame, not just keyframes, so none are lost between keyframes.
    if (f.allRespawned) this.pendingAll = true
    else {
      for (let i = 0; i < f.count; i++) {
        if (f.wasRespawned(i)) {
          this.pendingFlags[i] = 1
          this.pendingAny = true
        }
      }
    }
    if (rel - this.lastT < KEYFRAME_MS) return
    this.push(this.makeKeyframe(rel, f.cur, f.count, f.simTime, f.clusters, f.alive))
    this.lastT = rel
  }

  private makeKeyframe(
    t: number, cur: Float32Array, count: number, simTime: number, clusters: readonly Cluster[], alive: number | null,
  ): Keyframe {
    const pos = new Float32Array(count * 3)
    const weight = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS_PER_GHOST
      pos[i * 3] = cur[o + OFFSET.longitude]
      pos[i * 3 + 1] = cur[o + OFFSET.latitude]
      pos[i * 3 + 2] = cur[o + OFFSET.elevation]
      weight[i] = Math.round(Math.min(1, Math.max(0, cur[o + OFFSET.weight])) * 255)
    }
    return { t, count, pos, weight, respawned: this.takePending(), simTime, clusters, alive }
  }

  private takePending(): Uint8Array | 'all' | null {
    let r: Uint8Array | 'all' | null = null
    if (this.pendingAll) r = 'all'
    else if (this.pendingAny) r = this.pendingFlags.slice()
    this.pendingAll = false
    this.pendingAny = false
    this.pendingFlags.fill(0)
    return r
  }

  private push(k: Keyframe): void {
    this.keyframes.push(k)
    if (this.keyframes.length > MAX_KEYFRAMES) this.keyframes.shift()
  }

  /**
   * Insert an exact snapshot of what is on screen at history time `t` (used when pausing from live, so the
   * frozen picture is the real one and not a keyframe up to a second old). `drawn` is [lon, lat, elevation].
   */
  insertSnapshot(
    t: number, drawn: Float32Array, count: number, weightSource: Float32Array, simTime: number,
    clusters: readonly Cluster[], alive: number | null,
  ): void {
    if (this.epoch === null || count !== this.count) return
    const last = this.keyframes.at(-1)
    if (last && t <= last.t) return // already covered by a keyframe at or after t
    const pos = drawn.slice(0, count * 3)
    const weight = new Uint8Array(count)
    for (let i = 0; i < count; i++) {
      weight[i] = Math.round(Math.min(1, Math.max(0, weightSource[i * FLOATS_PER_GHOST + OFFSET.weight])) * 255)
    }
    this.push({ t, count, pos, weight, respawned: this.takePending(), simTime, clusters, alive })
    this.lastT = t
  }

  /** Record that an evidence, tasking or found message arrived (draws a tick on the time bar). */
  noteEvent(arrivalMs: number, kind: HistoryEvent['kind'], id?: string): void {
    if (this.epoch === null) return
    const t = arrivalMs - this.epoch
    // An upsert of a known id (a note that gets structured) is not a new tick and does not move its first-seen time.
    if (id !== undefined) {
      if (this.firstSeen.has(id)) return
      this.firstSeen.set(id, t)
    }
    this.events.push({ t, kind, id })
  }

  /** The stream just confirmed request `id` as approved or rejected. Only the first time counts. */
  noteDecision(arrivalMs: number, id: string, state: 'approved' | 'rejected'): void {
    if (this.epoch === null || this.decisions.has(id)) return
    this.decisions.set(id, { t: arrivalMs - this.epoch, state })
  }

  /** A log entry arrived. Only the first of each action is kept. */
  noteLog(arrivalMs: number, action: string): void {
    if (this.epoch === null || this.logAt.has(action)) return
    this.logAt.set(action, arrivalMs - this.epoch)
  }

  /** The drone feed opened. */
  noteFeedOpened(arrivalMs: number): void {
    if (this.epoch === null || this.feedOpenedAt !== undefined) return
    this.feedOpenedAt = arrivalMs - this.epoch
  }

  /** When the possible-match message first arrived, or undefined. */
  get foundAt(): number | undefined {
    return this.events.find((e) => e.kind === 'found')?.t
  }

  /** Approximate size of the recording in bytes (for the dev HUD and tests). */
  get approxBytes(): number {
    let n = 0
    for (const k of this.keyframes) {
      n += k.pos.byteLength + k.weight.byteLength + (k.respawned instanceof Uint8Array ? k.respawned.byteLength : 0)
    }
    return n
  }
}

export const history = new History()
