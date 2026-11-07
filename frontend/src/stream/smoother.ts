// Turns 5 data updates per second into continuous 60 fps motion.
//
// The backend sends a new ghost frame about every 200 ms. Drawn as-is, ghosts hop in 200 ms steps and
// nothing moves in between (step 13). This class keeps the last frame AND the position each ghost was
// being drawn at when that frame arrived, and on every animation frame blends between them by elapsed
// time. No React, no allocation per frame: it writes into preallocated typed arrays.
//
// Why a hand-written lerp and not deck.gl `transitions: { getPosition }`: transitions can't treat
// respawned slots differently (those are NEW ghosts and must not glide across the map) and they work
// against binary attributes. Why lerp from the DRAWN position and not the previous frame: if a frame
// arrives early the ghost is only part-way along its last segment; restarting from the previous frame
// would hop it backwards. Starting from where it is drawn keeps motion continuous.
//
// Pure and clock-free: every method takes `nowMs`, so tests use fake time.
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'

/** A respawned ghost fades in over this long (user choice, step 14). Step 35 owns the longer dissolve. */
export const FADE_MS = 300
/** Restrained warm tone, never cyan (cyan is reserved for the AI). Glow and density arrive in step 15. */
export const GHOST_RGB: readonly [number, number, number] = [255, 196, 110]
export const GHOST_ALPHA = 170

const DEFAULT_INTERVAL_MS = 200
const MIN_INTERVAL_MS = 50
const MAX_INTERVAL_MS = 1000
/** How much of each new arrival gap to blend into the frame-interval estimate. */
const INTERVAL_SMOOTHING = 0.3
const NEVER = -1e12

export interface SmootherOutput {
  /** [lon, lat, elevation] per slot (stride 12 bytes). */
  pos: Float32Array
  /** [r, g, b, a] per slot. Alpha carries the respawn fade. */
  col: Uint8ClampedArray
  count: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export class GhostSmoother {
  private cur: Float32Array | null = null // newest frame, ghostBuffer layout (stride 4)
  private count = 0
  private arrival = 0
  private interval = DEFAULT_INTERVAL_MS
  private from = new Float32Array(0) // where each ghost was DRAWN when the newest frame arrived (stride 3)
  private fadeStart = new Float64Array(0)
  private bufs: [SmootherOutput, SmootherOutput] = [this.makeOut(0), this.makeOut(0)]
  private flip = 0

  private makeOut(slots: number): SmootherOutput {
    return { pos: new Float32Array(slots * 3), col: new Uint8ClampedArray(slots * 4), count: 0 }
  }

  private ensure(slots: number): void {
    if (this.from.length >= slots * 3) return
    const cap = Math.ceil(slots * 1.25)
    const old = this.from
    this.from = new Float32Array(cap * 3)
    this.from.set(old)
    const oldFade = this.fadeStart
    this.fadeStart = new Float64Array(cap).fill(NEVER)
    this.fadeStart.set(oldFade)
    this.bufs = [this.makeOut(cap), this.makeOut(cap)]
  }

  /** Smoothed time between data frames, ms. */
  get frameIntervalMs(): number {
    return this.interval
  }

  /** Forget everything (case closed or replaced). */
  reset(): void {
    this.cur = null
    this.count = 0
    this.arrival = 0
    this.interval = DEFAULT_INTERVAL_MS
  }

  /**
   * A new ghost frame is in `cur` (ghostBuffer layout). `respawned` lists slots whose ghost died and was
   * replaced; `allRespawned` is the fallback while the backend doesn't send that list yet.
   */
  onFrame(
    arrivalMs: number,
    cur: Float32Array,
    count: number,
    respawned: Int32Array | null,
    allRespawned: boolean,
  ): void {
    if (count === 0) return this.reset()
    this.ensure(count)
    const first = this.cur === null || this.count !== count

    if (!first) {
      // Freeze the position each ghost is being drawn at RIGHT NOW as the start of the next segment.
      this.evaluate(arrivalMs, this.from)
      const gap = arrivalMs - this.arrival
      const clamped = Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, gap))
      this.interval = this.interval * (1 - INTERVAL_SMOOTHING) + clamped * INTERVAL_SMOOTHING
    }

    this.cur = cur
    this.count = count
    this.arrival = arrivalMs

    if (first || allRespawned) {
      // Brand-new swarm (or the whole swarm resampled): snap to the new positions and fade everything in.
      for (let i = 0; i < count; i++) this.snapAndFade(i, arrivalMs)
    } else if (respawned) {
      for (let k = 0; k < respawned.length; k++) {
        const i = respawned[k]
        if (i >= 0 && i < count) this.snapAndFade(i, arrivalMs)
      }
    }
  }

  /** A respawned slot is a NEW ghost: no glide from the dead one's position, hidden now, fading in. */
  private snapAndFade(i: number, arrivalMs: number): void {
    const cur = this.cur as Float32Array
    const o4 = i * FLOATS_PER_GHOST
    const o3 = i * 3
    this.from[o3] = cur[o4 + OFFSET.longitude]
    this.from[o3 + 1] = cur[o4 + OFFSET.latitude]
    this.from[o3 + 2] = cur[o4 + OFFSET.elevation]
    this.fadeStart[i] = arrivalMs
  }

  /** Blend `from` -> `cur` at time `nowMs` into `target` (stride 3). Never extrapolates past the newest frame. */
  private evaluate(nowMs: number, target: Float32Array): void {
    const cur = this.cur
    if (!cur) return
    const t = clamp01((nowMs - this.arrival) / this.interval)
    const from = this.from
    for (let i = 0; i < this.count; i++) {
      const o4 = i * FLOATS_PER_GHOST
      const o3 = i * 3
      target[o3] = from[o3] + (cur[o4 + OFFSET.longitude] - from[o3]) * t
      target[o3 + 1] = from[o3 + 1] + (cur[o4 + OFFSET.latitude] - from[o3 + 1]) * t
      target[o3 + 2] = from[o3 + 2] + (cur[o4 + OFFSET.elevation] - from[o3 + 2]) * t
    }
  }

  /** Positions and fade for time `nowMs`. The returned object alternates between two buffers so deck.gl re-uploads. */
  tick(nowMs: number): SmootherOutput {
    this.flip = this.flip === 0 ? 1 : 0
    const out = this.bufs[this.flip]
    out.count = this.cur ? this.count : 0
    if (!this.cur) return out
    this.evaluate(nowMs, out.pos)
    const [r, g, b] = GHOST_RGB
    for (let i = 0; i < this.count; i++) {
      const a = clamp01((nowMs - this.fadeStart[i]) / FADE_MS)
      const eased = 1 - (1 - a) * (1 - a) // ease-out: appears quickly, settles gently
      const o = i * 4
      out.col[o] = r
      out.col[o + 1] = g
      out.col[o + 2] = b
      out.col[o + 3] = Math.round(GHOST_ALPHA * eased)
    }
    return out
  }
}
