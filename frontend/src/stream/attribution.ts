// What did this card remove, and what stayed or arrived? (step 36)
//
// When evidence arrives the engine changes the swarm in two ways: it REPLACES ghosts that no longer fit (the slots in
// `respawned`; a surprising sighting reseeds most of the swarm at the new spot) and it DIMS ghosts (it turns their
// weight down, e.g. every ghost inside a searched area, without replacing them yet). Both are the card's effect, so
// both count as "removed":
//   removed = ghosts replaced in the window (where the screen last drew them) + ghosts whose weight fell by 40% or
//             more over it (where they were when the card arrived);
//   stayed  = every other ghost, as it is when the window closes;
//   arrived = the new ghosts now in the replaced slots (a reseed's cluster at the sighting).
//
// Deaths are credited to THE MOST RECENT evidence: a window opens when an evidence item arrives and stays open until
// the next one. That is an approximation (the engine does not say which card caused which change, so a ghost it
// replaced or dimmed for another reason inside the window is also credited to this card; exact attribution would
// need the engine to say so). Outside React, typed arrays only; positions and weights come in as arguments, so it is
// tested without a map.
import { FLOATS_PER_GHOST, OFFSET } from './ghostBuffer'
import type { Kills } from './smoother'

const MAX_WINDOWS = 80 // a long case keeps the latest 80 cards' windows; older cards simply have no record
/** A ghost whose weight fell below this share of what it was when the card arrived counts as removed (dimmed). */
export const DIM_RATIO = 0.6
/** Ghosts already nearly weightless when the card arrived are not credited with a further drop. */
const MIN_WEIGHT_TO_DIM = 0.2

export interface AttributionSnapshot {
  /** Replaced ghosts (where they were drawn when they died) then dimmed ghosts (where they were when the card arrived). [lon, lat, elevation] each. */
  removed: Float32Array
  removedCount: number
  killedCount: number
  dimmedCount: number
  /** Ghosts that were neither replaced nor dimmed, as they are now (or when the window closed). */
  stayed: Float32Array
  stayedCount: number
  /** The new ghosts in the replaced slots. */
  arrived: Float32Array
  arrivedCount: number
  /** True while it is the latest card, so effects may still be added to it. */
  open: boolean
}

type Computed = Omit<AttributionSnapshot, 'open'>

class Window {
  readonly id: string
  count = 0
  slots = new Int32Array(256)
  pos = new Float32Array(256 * 3)
  /** The swarm when the card arrived: slot count, weights and positions (needed to see who was dimmed). Dropped once closed. */
  openCount = 0
  openWeights: Float32Array | null = null
  openPos: Float32Array | null = null
  /** Set when the window closes. */
  final: Computed | null = null

  constructor(id: string) {
    this.id = id
  }

  add(k: Kills): void {
    const need = this.count + k.count
    if (need > this.slots.length) {
      const cap = Math.max(need, this.slots.length * 2)
      const slots = new Int32Array(cap)
      slots.set(this.slots.subarray(0, this.count))
      const pos = new Float32Array(cap * 3)
      pos.set(this.pos.subarray(0, this.count * 3))
      this.slots = slots
      this.pos = pos
    }
    this.slots.set(k.slots.subarray(0, k.count), this.count)
    this.pos.set(k.pos.subarray(0, k.count * 3), this.count * 3)
    this.count = need
  }

  /** Remember the swarm as it is now (the card just arrived). */
  snapshotOpen(count: number, buffer: Float32Array): void {
    this.openCount = count
    const weights = new Float32Array(count)
    const pos = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS_PER_GHOST
      weights[i] = buffer[o + OFFSET.weight]
      pos[i * 3] = buffer[o + OFFSET.longitude]
      pos[i * 3 + 1] = buffer[o + OFFSET.latitude]
      pos[i * 3 + 2] = buffer[o + OFFSET.elevation]
    }
    this.openWeights = weights
    this.openPos = pos
  }

  /** Sort the swarm as it is now into removed, stayed and arrived. */
  compute(count: number, buffer: Float32Array): Computed {
    const replaced = new Uint8Array(count)
    for (let i = 0; i < this.count; i++) if (this.slots[i] < count) replaced[this.slots[i]] = 1
    const dimmed = new Uint8Array(count)
    let dimmedCount = 0
    const w0 = this.openWeights
    if (w0 && this.openCount === count) {
      for (let i = 0; i < count; i++) {
        if (replaced[i]) continue
        const before = w0[i]
        if (before >= MIN_WEIGHT_TO_DIM && buffer[i * FLOATS_PER_GHOST + OFFSET.weight] < DIM_RATIO * before) {
          dimmed[i] = 1
          dimmedCount++
        }
      }
    }
    let stayedCount = 0
    let arrivedCount = 0
    for (let i = 0; i < count; i++) {
      if (replaced[i]) arrivedCount++
      else if (!dimmed[i]) stayedCount++
    }
    const removed = new Float32Array((this.count + dimmedCount) * 3)
    removed.set(this.pos.subarray(0, this.count * 3))
    const stayed = new Float32Array(stayedCount * 3)
    const arrived = new Float32Array(arrivedCount * 3)
    let r = this.count
    let s = 0
    let a = 0
    const open = this.openPos
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS_PER_GHOST
      if (replaced[i]) {
        arrived[a * 3] = buffer[o + OFFSET.longitude]
        arrived[a * 3 + 1] = buffer[o + OFFSET.latitude]
        arrived[a * 3 + 2] = buffer[o + OFFSET.elevation]
        a++
      } else if (dimmed[i] && open) {
        removed[r * 3] = open[i * 3]
        removed[r * 3 + 1] = open[i * 3 + 1]
        removed[r * 3 + 2] = open[i * 3 + 2]
        r++
      } else {
        stayed[s * 3] = buffer[o + OFFSET.longitude]
        stayed[s * 3 + 1] = buffer[o + OFFSET.latitude]
        stayed[s * 3 + 2] = buffer[o + OFFSET.elevation]
        s++
      }
    }
    return { removed, removedCount: this.count + dimmedCount, killedCount: this.count, dimmedCount, stayed, stayedCount, arrived, arrivedCount }
  }
}

export class Attribution {
  private windows = new Map<string, Window>()
  private open: Window | null = null

  /**
   * An evidence item arrived. A plain note changes nothing (the engine ignores notes; the structured version
   * comes later with the same id), so it opens no window. Otherwise the previous window closes, with the swarm as it
   * is now (before the new evidence's own effects reach it), and a window opens for this id, remembering the swarm
   * as it is now so that dimming can be seen later. The same id arriving again while its window is open continues it.
   */
  noteEvidence(id: string, kind: string, count: number, buffer: Float32Array): void {
    if (kind === 'note') return
    if (this.open && this.open.id === id) return
    this.closeOpen(count, buffer)
    let w = this.windows.get(id)
    if (!w) {
      w = new Window(id)
      w.snapshotOpen(count, buffer)
      this.windows.set(id, w)
      if (this.windows.size > MAX_WINDOWS) this.windows.delete(this.windows.keys().next().value as string)
    } else {
      w.final = null // reopened: its old result no longer describes it
      if (!w.openWeights) w.snapshotOpen(count, buffer)
    }
    this.open = w
  }

  /** The ghosts replaced in the newest frame go to the open window. With none open (before any evidence) they are nobody's. */
  onKills(kills: Kills): void {
    if (this.open && kills.count > 0) this.open.add(kills)
  }

  private closeOpen(count: number, buffer: Float32Array): void {
    const w = this.open
    if (!w) return
    w.final = w.compute(count, buffer)
    w.openWeights = null
    w.openPos = null
    this.open = null
  }

  /** What card `id` removed, kept and brought in, or null if this view has no record of it (it arrived before the page opened). */
  snapshot(id: string, count: number, buffer: Float32Array): AttributionSnapshot | null {
    const w = this.windows.get(id)
    if (!w) return null
    const open = this.open === w
    return { ...(open || !w.final ? w.compute(count, buffer) : w.final), open }
  }

  has(id: string): boolean {
    return this.windows.has(id)
  }

  /** A new case, or the case was lost: forget everything. */
  reset(): void {
    this.windows.clear()
    this.open = null
  }
}

export const attribution = new Attribution()
