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
import { Dissolve, DISSOLVE_MS } from './dissolve'
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'

/** A respawned ghost fades in over this long (user choice, step 14). The dying one dissolves over `DISSOLVE_MS` (step 35). */
export const FADE_MS = 300
/**
 * Warm amber as it should APPEAR (sRGB), never cyan (cyan is reserved for the AI). Drawn additively, so
 * overlapping ghosts add up towards yellow and white: that is what makes dense areas glow "hotter" with no
 * legend (step 15).
 */
export const GHOST_RGB: readonly [number, number, number] = [255, 176, 64]

/** sRGB 0-255 -> linear light 0-255. */
export function srgbToLinear(c: number): number {
  const v = c / 255
  return Math.round(255 * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
}

/** "#rrggbb" (sRGB) -> [r, g, b] in linear light, 0-255: what the map framebuffer wants (see GHOST_RGB_LINEAR). */
export function hexToLinear(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => srgbToLinear(parseInt(hex.slice(i, i + 2), 16))) as [number, number, number]
}

/**
 * What we actually write into the colour buffer. MEASURED (step 15): the map framebuffer treats shader
 * colours as LINEAR light and gamma-encodes on display, so brightness rises roughly as opacity^0.4, not
 * linearly, and an "sRGB amber" of (255,176,64) displays as a pale (255,217,138). Writing the linear
 * equivalent, (255,111,13), makes a lone ghost look like the amber we mean, and makes additive sums behave.
 */
export const GHOST_RGB_LINEAR: readonly [number, number, number] = [
  srgbToLinear(GHOST_RGB[0]),
  srgbToLinear(GHOST_RGB[1]),
  srgbToLinear(GHOST_RGB[2]),
]
/** Per-ghost alpha at full brightness and full fade-in; the glow layers scale it with their own opacity. */
export const GHOST_ALPHA = 255
/** An unlikely ghost (weight near 0) is dimmed to this fraction of full brightness, never fully hidden. */
export const MIN_BRIGHTNESS = 0.25

/** Ghost brightness from its probability weight (0..1): dimmer when less likely. */
export function weightBrightness(weight: number): number {
  const w = Number.isFinite(weight) ? clamp01(weight) : 1
  return MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * w
}

const DEFAULT_INTERVAL_MS = 200
const MIN_INTERVAL_MS = 50
const MAX_INTERVAL_MS = 1000
/** How much of each new arrival gap to blend into the frame-interval estimate. */
const INTERVAL_SMOOTHING = 0.3
const NEVER = -1e12

/** The ghosts replaced in the newest frame: their slots and where they were DRAWN when they died (step 36 credits them to evidence). */
export interface Kills {
  count: number
  slots: Int32Array
  /** [lon, lat, elevation] per killed ghost (stride 3). */
  pos: Float32Array
}

export interface SmootherOutput {
  /** [lon, lat, elevation] per slot (stride 12 bytes). */
  pos: Float32Array
  /** [r, g, b, a] per slot. Alpha carries the respawn fade times the probability brightness. */
  col: Uint8ClampedArray
  count: number
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export class GhostSmoother {
  private cur: Float32Array | null = null // newest frame, ghostBuffer layout (stride 4)
  private count = 0
  private arrival = 0
  private interval = DEFAULT_INTERVAL_MS
  private from = new Float32Array(0) // where each ghost was DRAWN when the newest frame arrived (stride 3)
  private fadeStart = new Float64Array(0)
  /** 1 for slots respawned in the newest frame (read by the trail buffer). */
  private respawnFlags = new Uint8Array(0)
  private allFlag = false
  private bufs: [SmootherOutput, SmootherOutput] = [this.makeOut(0), this.makeOut(0)]
  private flip = 0
  /** The ghosts that were just replaced, still on screen and dissolving (step 35). */
  readonly dissolve = new Dissolve(GHOST_RGB_LINEAR)
  /** Who died in the newest frame (empty on the first frame of a swarm). Valid until the next frame. */
  readonly kills: Kills = { count: 0, slots: new Int32Array(0), pos: new Float32Array(0) }
  /** Dev slow-motion: 1 normally; 8 makes the fade-in and the dissolve eight times slower so they can be watched. */
  private slowmo = 1

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
    this.respawnFlags = new Uint8Array(cap)
    this.bufs = [this.makeOut(cap), this.makeOut(cap)]
  }

  /**
   * Where each ghost was DRAWN when the newest frame arrived ([lon, lat, elevation], stride 3). For a
   * respawned slot this is its new position. The trail buffer samples this, so a trail follows exactly
   * what the screen showed. Read-only; valid until the next frame.
   */
  get drawnAtArrival(): Float32Array {
    return this.from
  }

  /** True when EVERY slot is new in the newest frame (a new swarm, or the fallback after evidence). */
  get respawnedAll(): boolean {
    return this.allFlag
  }

  /** True if slot `i` was respawned in the newest frame (every slot counts on a case's first frame and on the fallback). */
  wasRespawned(i: number): boolean {
    return this.allFlag || this.respawnFlags[i] === 1
  }

  /** Smoothed time between data frames, ms. */
  get frameIntervalMs(): number {
    return this.interval
  }

  /** Slow the fade-in and the dissolve down by `factor` (dev only), and turn the dissolve off with `reducedMotion`. */
  configure(opts: { slowmo?: number; reducedMotion?: boolean }): void {
    if (opts.slowmo !== undefined) this.slowmo = Math.max(1, opts.slowmo)
    this.dissolve.durationMs = opts.reducedMotion ? 0 : DISSOLVE_MS * this.slowmo
  }

  /** Forget everything (case closed or replaced). */
  reset(): void {
    this.dissolve.reset()
    this.cur = null
    this.allFlag = false
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
    const prev = this.cur // the previous frame: the dying ghosts' weights are read from it
    this.kills.count = 0

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
    this.respawnFlags.fill(0)
    this.allFlag = first || allRespawned

    if (first || allRespawned) {
      // Brand-new swarm (or the whole swarm resampled): snap to the new positions and fade everything in. A swarm
      // that was resampled keeps its old ghosts dissolving; a brand-new swarm has nothing to dissolve.
      if (!first && prev) for (let i = 0; i < count; i++) this.startDissolve(i, arrivalMs, prev)
      for (let i = 0; i < count; i++) this.snapAndFade(i, arrivalMs)
    } else if (respawned) {
      for (let k = 0; k < respawned.length; k++) {
        const i = respawned[k]
        if (i >= 0 && i < count) {
          if (prev) this.startDissolve(i, arrivalMs, prev)
          this.snapAndFade(i, arrivalMs)
        }
      }
    }
  }

  private recordKill(slot: number, x: number, y: number, z: number): void {
    const k = this.kills
    if (k.count >= k.slots.length) {
      const cap = Math.max(1024, k.slots.length * 2)
      const slots = new Int32Array(cap)
      slots.set(k.slots)
      const pos = new Float32Array(cap * 3)
      pos.set(k.pos)
      ;(this.kills as { slots: Int32Array }).slots = slots
      ;(this.kills as { pos: Float32Array }).pos = pos
    }
    const n = this.kills.count++
    this.kills.slots[n] = slot
    this.kills.pos[n * 3] = x
    this.kills.pos[n * 3 + 1] = y
    this.kills.pos[n * 3 + 2] = z
  }

  /** The ghost in slot `i` is about to be replaced: hand its drawn position and brightness to the dissolve. */
  private startDissolve(i: number, arrivalMs: number, prev: Float32Array): void {
    const o3 = i * 3
    this.recordKill(i, this.from[o3], this.from[o3 + 1], this.from[o3 + 2])
    const a = clamp01((arrivalMs - this.fadeStart[i]) / (FADE_MS * this.slowmo))
    const eased = 1 - (1 - a) * (1 - a)
    const bright = weightBrightness(prev[i * FLOATS_PER_GHOST + OFFSET.weight])
    this.dissolve.capture(i, this.from[o3], this.from[o3 + 1], this.from[o3 + 2], GHOST_ALPHA * eased * bright, arrivalMs)
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
    this.respawnFlags[i] = 1
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
    const [r, g, b] = GHOST_RGB_LINEAR
    const cur = this.cur
    for (let i = 0; i < this.count; i++) {
      const a = clamp01((nowMs - this.fadeStart[i]) / (FADE_MS * this.slowmo))
      const eased = 1 - (1 - a) * (1 - a) // ease-out: appears quickly, settles gently
      const bright = weightBrightness(cur[i * FLOATS_PER_GHOST + OFFSET.weight])
      const o = i * 4
      out.col[o] = r
      out.col[o + 1] = g
      out.col[o + 2] = b
      out.col[o + 3] = Math.round(GHOST_ALPHA * eased * bright)
    }
    return out
  }
}
