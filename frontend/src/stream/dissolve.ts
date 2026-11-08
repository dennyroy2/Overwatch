// Dissolve, don't disappear (step 35). When evidence kills a ghost the backend reuses its slot for a new ghost
// (`GhostFrame.respawned`). The new ghost fades in (step 14); this keeps the OLD one on screen for a moment: it
// stays where it was drawn, and fades and shrinks to nothing over ~600 ms, so the eye sees the cloud being
// withdrawn from a place instead of ghosts blinking out.
//
// No nearest-neighbour matching is needed: slot i in `respawned` IS the ghost that died. One dying ghost per slot
// at a time (if a slot is replaced again inside the window, the older one simply stops). Outside React, typed
// arrays only, and clock-free like the smoother: every method takes `nowMs`.

/** How long a dying ghost takes to fade and shrink away. */
export const DISSOLVE_MS = 600
const NEVER = -1e12

export interface DissolveOutput {
  /** [lon, lat, elevation] per dying ghost (stride 3). */
  pos: Float32Array
  /** [r, g, b, a] per dying ghost: its colour, with alpha fading from what it had to 0. */
  col: Uint8ClampedArray
  /** Radius in pixels of the soft halo and of the bright core, shrinking to 0. */
  haloRadius: Float32Array
  coreRadius: Float32Array
  count: number
}

const smooth = (t: number): number => t * t * (3 - 2 * t)

export class Dissolve {
  /** How long a dissolve lasts, ms. 0 turns it off (reduced motion: ghosts just go, as before). */
  durationMs = DISSOLVE_MS
  private start = new Float64Array(0) // when each slot's dying ghost began to fade; NEVER if none
  private pos = new Float32Array(0)
  private alpha0 = new Uint8ClampedArray(0)
  private used = 0 // highest slot ever captured + 1, so a tick scans only what could be dying
  private bufs: [DissolveOutput, DissolveOutput]
  private flip = 0
  private capacity = 0

  private readonly rgb: readonly [number, number, number]

  constructor(rgb: readonly [number, number, number]) {
    this.rgb = rgb
    this.bufs = [this.makeOut(0), this.makeOut(0)]
  }

  private makeOut(n: number): DissolveOutput {
    return { pos: new Float32Array(n * 3), col: new Uint8ClampedArray(n * 4), haloRadius: new Float32Array(n), coreRadius: new Float32Array(n), count: 0 }
  }

  private ensure(slots: number): void {
    if (slots <= this.capacity) return
    const cap = Math.ceil(slots * 1.25)
    const start = new Float64Array(cap).fill(NEVER)
    start.set(this.start)
    const pos = new Float32Array(cap * 3)
    pos.set(this.pos)
    const a = new Uint8ClampedArray(cap)
    a.set(this.alpha0)
    this.start = start
    this.pos = pos
    this.alpha0 = a
    this.bufs = [this.makeOut(cap), this.makeOut(cap)]
    this.capacity = cap
  }

  /**
   * Slot `slot`'s ghost has just been replaced. `x, y, z` is where it was DRAWN and `alpha` how bright it was
   * (0..255), so the dissolve starts exactly from what the screen showed. A ghost that was not visible
   * (alpha 0, still fading in) has nothing to dissolve.
   */
  capture(slot: number, x: number, y: number, z: number, alpha: number, nowMs: number): void {
    if (this.durationMs <= 0 || alpha <= 0.5 || slot < 0) return
    this.ensure(slot + 1)
    const o = slot * 3
    this.pos[o] = x
    this.pos[o + 1] = y
    this.pos[o + 2] = z
    this.alpha0[slot] = alpha
    this.start[slot] = nowMs
    if (slot >= this.used) this.used = slot + 1
  }

  /** The dying ghosts at `nowMs`; `haloPx` and `corePx` are the live ghosts' radii right now, which they shrink from. */
  tick(nowMs: number, haloPx: number, corePx: number): DissolveOutput {
    this.flip = this.flip === 0 ? 1 : 0
    const out = this.bufs[this.flip]
    let n = 0
    const [r, g, b] = this.rgb
    for (let i = 0; i < this.used; i++) {
      const s = this.start[i]
      if (s === NEVER) continue
      const t = (nowMs - s) / this.durationMs
      if (t >= 1 || t < 0) {
        if (t >= 1) this.start[i] = NEVER // finished: free the slot
        continue
      }
      const k = 1 - smooth(t)
      out.pos[n * 3] = this.pos[i * 3]
      out.pos[n * 3 + 1] = this.pos[i * 3 + 1]
      out.pos[n * 3 + 2] = this.pos[i * 3 + 2]
      out.col[n * 4] = r
      out.col[n * 4 + 1] = g
      out.col[n * 4 + 2] = b
      out.col[n * 4 + 3] = Math.round(this.alpha0[i] * k)
      out.haloRadius[n] = haloPx * k
      out.coreRadius[n] = corePx * k
      n++
    }
    out.count = n
    return out
  }

  /** How many are dissolving right now (as of the last tick). */
  get active(): number {
    return this.bufs[this.flip].count
  }

  /** Forget everything (case closed or replaced, or the picture was paused). */
  reset(): void {
    this.start.fill(NEVER)
    this.used = 0
    this.bufs[0].count = 0
    this.bufs[1].count = 0
  }
}
