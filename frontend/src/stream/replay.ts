// Draws a recorded moment (step 38, built early). Given the recording and a history time T it produces the
// same kind of arrays the live path gives deck.gl, so the paused/replayed swarm is drawn by exactly the same
// layers (glow, cores, trails) and looks the same.
//
// Between two keyframes ghosts glide linearly. A slot that was RESPAWNED in that interval is a new ghost, so
// it does not glide: it shows its old position until the middle of the interval, then its new position
// fading in over FADE_MS, the same behaviour as the live smoother.
import { DISSOLVE_MS, type DissolveOutput } from './dissolve'
import { FADE_MS, GHOST_ALPHA, GHOST_RGB_LINEAR, weightBrightness, type SmootherOutput } from './smoother'
import { HISTORY, TRAIL_MS, TRAIL_SLOTS, type TrailOutput, VERTS } from './trails'
import type { History, Keyframe } from './history'
import type { Cluster } from '@/types'

export interface ReplayFrame {
  out: SmootherOutput
  trails: TrailOutput
  /** The ghosts that were replaced just before this moment, still fading out where they were (step 35's dissolve, replayed). */
  dying: DissolveOutput
  simTime: number
  alive: number | null
  clusters: readonly Cluster[]
  /** Index of the keyframe at or before T. */
  keyframe: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (t: number): number => t * t * (3 - 2 * t)

const flagged = (k: Keyframe, slot: number): boolean =>
  k.respawned === 'all' || (k.respawned !== null && k.respawned[slot] === 1)

/** Index of the last keyframe with t <= T (0 if T is before the first). */
export function locate(keyframes: readonly Keyframe[], T: number): number {
  let lo = 0
  let hi = keyframes.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (keyframes[mid].t <= T) lo = mid
    else hi = mid - 1
  }
  return lo
}

export class ReplayRenderer {
  private outs: [SmootherOutput, SmootherOutput] = [this.makeOut(0), this.makeOut(0)]
  private trailOuts: [TrailOutput, TrailOutput] = [this.makeTrails(0), this.makeTrails(0)]
  private dyingOuts: [DissolveOutput, DissolveOutput] = [this.makeDying(0), this.makeDying(0)]
  private flip = 0
  private allocated = 0

  private makeDying(slots: number): DissolveOutput {
    return { pos: new Float32Array(slots * 3), col: new Uint8ClampedArray(slots * 4), haloRadius: new Float32Array(slots), coreRadius: new Float32Array(slots), count: 0 }
  }

  private makeOut(slots: number): SmootherOutput {
    return { pos: new Float32Array(slots * 3), col: new Uint8ClampedArray(slots * 4), count: 0 }
  }

  private makeTrails(trails: number): TrailOutput {
    const startIndices = new Uint32Array(trails + 1)
    for (let k = 0; k <= trails; k++) startIndices[k] = k * VERTS
    return { length: trails, path: new Float32Array(trails * VERTS * 3), timestamps: new Float32Array(trails * VERTS), startIndices, currentTime: 0 }
  }

  /** Where slot `i` is at time T, written into `out[o..o+2]`. Respawned slots jump at the interval's midpoint. */
  private position(ks: readonly Keyframe[], i: number, slot: number, T: number, out: Float32Array, o: number): void {
    const a = ks[i]
    const b = ks[i + 1]
    const s = slot * 3
    if (!b || T <= a.t) {
      out[o] = a.pos[s]; out[o + 1] = a.pos[s + 1]; out[o + 2] = a.pos[s + 2]
      return
    }
    if (flagged(b, slot)) {
      const src = T < a.t + (b.t - a.t) * 0.5 ? a : b
      out[o] = src.pos[s]; out[o + 1] = src.pos[s + 1]; out[o + 2] = src.pos[s + 2]
      return
    }
    const u = clamp01((T - a.t) / (b.t - a.t))
    out[o] = a.pos[s] + (b.pos[s] - a.pos[s]) * u
    out[o + 1] = a.pos[s + 1] + (b.pos[s + 1] - a.pos[s + 1]) * u
    out[o + 2] = a.pos[s + 2] + (b.pos[s + 2] - a.pos[s + 2]) * u
  }

  /** Alpha (0..1) of slot `slot` at T: a respawned ghost fades in from the middle of its interval. */
  private fade(ks: readonly Keyframe[], i: number, slot: number, T: number): number {
    const a = ks[i]
    const b = ks[i + 1]
    if (i === 0 && a.respawned === 'all' && (!b || T < b.t)) {
      return easeOut(clamp01((T - a.t) / FADE_MS)) // the swarm of a new case fades in
    }
    if (b && flagged(b, slot)) {
      const mid = a.t + (b.t - a.t) * 0.5
      return T < mid ? 1 : easeOut(clamp01((T - mid) / FADE_MS))
    }
    return 1
  }

  /**
   * The ghosts replaced in the half-second-to-1.5-second before `T`, drawn where they were and fading out over
   * `dissolveMs` from the middle of their interval (where the replay swaps old for new). Scrubbing BACKWARDS across
   * that moment brings them back: they un-die. `haloPx` and `corePx` are the live ghosts' radii they shrink from.
   */
  private fillDying(ks: readonly Keyframe[], i: number, T: number, dissolveMs: number, haloPx: number, corePx: number, out: DissolveOutput): void {
    let n = 0
    const [r, g, bl] = GHOST_RGB_LINEAR
    if (dissolveMs > 0) {
      for (const j of [i - 1, i]) {
        const a = ks[j]
        const b = ks[j + 1]
        if (!a || !b || b.respawned === null || a.count !== b.count) continue
        const age = T - (a.t + (b.t - a.t) * 0.5)
        if (age < 0 || age >= dissolveMs) continue
        const k = 1 - smooth(age / dissolveMs)
        for (let s = 0; s < a.count; s++) {
          if (!flagged(b, s)) continue
          const bright = weightBrightness(a.weight[s] / 255)
          out.pos[n * 3] = a.pos[s * 3]
          out.pos[n * 3 + 1] = a.pos[s * 3 + 1]
          out.pos[n * 3 + 2] = a.pos[s * 3 + 2]
          out.col[n * 4] = r
          out.col[n * 4 + 1] = g
          out.col[n * 4 + 2] = bl
          out.col[n * 4 + 3] = Math.round(GHOST_ALPHA * k * bright)
          out.haloRadius[n] = haloPx * k
          out.coreRadius[n] = corePx * k
          n++
        }
      }
    }
    out.count = n
  }

  /** The moment at history time `T`. Returns null if nothing is recorded. */
  render(h: History, T: number, haloPx = 0, corePx = 0, dissolveMs = DISSOLVE_MS): ReplayFrame | null {
    const ks = h.keyframes
    if (ks.length === 0) return null
    const i = locate(ks, T)
    const k = ks[i]
    const count = k.count
    if (count !== this.allocated) {
      this.outs = [this.makeOut(count), this.makeOut(count)]
      const trails = Math.min(TRAIL_SLOTS, count)
      this.trailOuts = [this.makeTrails(trails), this.makeTrails(trails)]
      this.dyingOuts = [this.makeDying(count), this.makeDying(count)]
      this.allocated = count
    }
    this.flip = this.flip === 0 ? 1 : 0
    const out = this.outs[this.flip]
    const trails = this.trailOuts[this.flip]
    const dying = this.dyingOuts[this.flip]
    out.count = count
    const [r, g, bl] = GHOST_RGB_LINEAR
    for (let s = 0; s < count; s++) {
      this.position(ks, i, s, T, out.pos, s * 3)
      const o = s * 4
      out.col[o] = r
      out.col[o + 1] = g
      out.col[o + 2] = bl
      out.col[o + 3] = Math.round(GHOST_ALPHA * this.fade(ks, i, s, T) * weightBrightness(k.weight[s] / 255))
    }
    this.fillTrails(ks, count, T, trails)
    this.fillDying(ks, i, T, dissolveMs, haloPx, corePx, dying)
    const next = ks[i + 1]
    const u = next && next.t > k.t ? clamp01((T - k.t) / (next.t - k.t)) : 0
    const simTime = next ? k.simTime + (next.simTime - k.simTime) * u : k.simTime // the sim clock keeps ticking smoothly
    return { out, trails, dying, simTime, alive: k.alive, clusters: k.clusters, keyframe: i }
  }

  /** Reconstruct the last ~3 s of motion for the tracked ghosts from the keyframes. */
  private fillTrails(ks: readonly Keyframe[], count: number, T: number, tr: TrailOutput): void {
    const M = tr.length
    tr.currentTime = T
    // Keyframes that overlap the trail window; used to find when a slot was last respawned inside it.
    const first = locate(ks, T - TRAIL_MS)
    const tmp = new Float32Array(3)
    for (let k = 0; k < M; k++) {
      const slot = Math.floor((k * count) / M)
      // When was this slot last replaced inside the window? Older vertices collapse onto that moment.
      let cut = -Infinity
      for (let j = first; j < ks.length - 1 && ks[j].t <= T; j++) {
        const b = ks[j + 1]
        if (flagged(b, slot)) {
          const mid = ks[j].t + (b.t - ks[j].t) * 0.5
          if (mid <= T && mid > cut) cut = mid
        }
      }
      for (let v = 0; v < VERTS; v++) {
        // v = 0..HISTORY-1 are history vertices, oldest first; v = HISTORY is the head (now).
        let tv = v === HISTORY ? T : T - (TRAIL_MS * (HISTORY - v)) / HISTORY
        if (tv < cut) tv = cut
        const idx = locate(ks, tv)
        this.position(ks, idx, slot, tv, tmp, 0)
        const p = (k * VERTS + v) * 3
        tr.path[p] = tmp[0]
        tr.path[p + 1] = tmp[1]
        tr.path[p + 2] = tmp[2]
        tr.timestamps[k * VERTS + v] = tv
      }
    }
  }
}

function easeOut(a: number): number {
  return 1 - (1 - a) * (1 - a)
}
