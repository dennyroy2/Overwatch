// Short fading comet tails behind a subsample of ghosts (step 16): they show which way the swarm is
// drifting. Pure data code, no React and no deck.gl: it fills preallocated typed arrays that a
// TripsLayer reads as BINARY attributes.
//
// How a trail is built: every ~200 ms we record where each tracked ghost was DRAWN (the smoother's
// position at that moment), keeping the last ~3 s; the newest vertex of every path (the head) is the
// ghost's current smoothed position. So the tail and the head always agree with the glide on screen.
//
// A respawned slot is a NEW ghost: its trail is cleared at once (all of its vertices collapse onto its new
// position) so a trail never joins a dead ghost to its replacement. Only that slot is cleared.
//
// Timestamps are milliseconds RELATIVE to the first frame, so they stay small enough for float32.

/** How long a tail is (user choice, step 16). */
export const TRAIL_MS = 3000
/** Minimum time between recorded samples; faster data frames are skipped so the tail keeps its length. */
export const SAMPLE_MS = 200
/** Ghosts that carry a trail: a fixed, evenly spaced subset (the same ghosts every frame). */
export const TRAIL_SLOTS = 1500

/** History vertices per trail; plus one head vertex that follows the smoothed position. */
export const HISTORY = Math.ceil(TRAIL_MS / SAMPLE_MS) + 1
export const VERTS = HISTORY + 1

export interface TrailOutput {
  /** Number of trails (paths). */
  length: number
  /** [lon, lat, elevation] per vertex, VERTS vertices per trail, oldest first, head last. */
  path: Float32Array
  /** Milliseconds relative to the first frame, one per vertex. */
  timestamps: Float32Array
  /** First vertex of each trail (constant stride; deck.gl needs it for binary paths). */
  startIndices: Uint32Array
  /** The TripsLayer `currentTime` for this frame, in the same relative milliseconds. */
  currentTime: number
}

/** What the trail buffer needs to know about each frame; the smoother provides all of it. */
export interface TrailSource {
  /** Where each ghost was drawn at the newest frame's arrival (stride 3). */
  drawnAtArrival: Float32Array
  wasRespawned(slot: number): boolean
}

export class TrailBuffer {
  private count = 0
  private slots = 0
  private epoch = 0
  private lastSample = -Infinity
  private slotOf = new Int32Array(0) // tracked trail k -> ghost slot
  private histPath = new Float32Array(0)
  private histTs = new Float32Array(0)
  private bufs: [TrailOutput, TrailOutput] = [this.makeOut(0), this.makeOut(0)]
  private flip = 0

  private makeOut(trails: number): TrailOutput {
    const startIndices = new Uint32Array(trails + 1)
    for (let k = 0; k <= trails; k++) startIndices[k] = k * VERTS
    return {
      length: trails,
      path: new Float32Array(trails * VERTS * 3),
      timestamps: new Float32Array(trails * VERTS),
      startIndices,
      currentTime: 0,
    }
  }

  /** Number of tracked trails. */
  get trailCount(): number {
    return this.slots
  }

  /** The ghost slot that trail `k` follows. */
  slotForTrail(k: number): number {
    return this.slotOf[k]
  }

  reset(): void {
    this.count = 0
    this.slots = 0
    this.epoch = 0
    this.lastSample = -Infinity
  }

  /** A new data frame arrived. `src` is the smoother's view of it. */
  onFrame(arrivalMs: number, count: number, src: TrailSource): void {
    if (count === 0) return this.reset()
    if (count !== this.count) this.allocate(count, arrivalMs)
    const rel = arrivalMs - this.epoch
    const sampleDue = arrivalMs - this.lastSample >= SAMPLE_MS
    const drawn = src.drawnAtArrival
    let sampled = false
    for (let k = 0; k < this.slots; k++) {
      const i = this.slotOf[k]
      const v0 = k * VERTS
      const x = drawn[i * 3]
      const y = drawn[i * 3 + 1]
      const z = drawn[i * 3 + 2]
      if (src.wasRespawned(i)) {
        // New ghost: wipe its trail, only this slot's.
        for (let v = 0; v < HISTORY; v++) this.setVertex(v0 + v, x, y, z, rel)
      } else if (sampleDue) {
        this.histPath.copyWithin(v0 * 3, (v0 + 1) * 3, (v0 + HISTORY) * 3)
        this.histTs.copyWithin(v0, v0 + 1, v0 + HISTORY)
        this.setVertex(v0 + HISTORY - 1, x, y, z, rel)
        sampled = true
      }
    }
    if (sampled) this.lastSample = arrivalMs
  }

  private setVertex(v: number, x: number, y: number, z: number, t: number): void {
    this.histPath[v * 3] = x
    this.histPath[v * 3 + 1] = y
    this.histPath[v * 3 + 2] = z
    this.histTs[v] = t
  }

  private allocate(count: number, arrivalMs: number): void {
    this.count = count
    this.slots = Math.min(TRAIL_SLOTS, count)
    this.slotOf = new Int32Array(this.slots)
    for (let k = 0; k < this.slots; k++) this.slotOf[k] = Math.floor((k * count) / this.slots)
    this.histPath = new Float32Array(this.slots * VERTS * 3)
    this.histTs = new Float32Array(this.slots * VERTS)
    this.bufs = [this.makeOut(this.slots), this.makeOut(this.slots)]
    this.epoch = arrivalMs
    this.lastSample = -Infinity
  }

  /**
   * Trails for time `nowMs`. `head` is the smoother's output positions (stride 3). The returned object
   * alternates between two buffers so deck.gl re-uploads each frame.
   */
  tick(nowMs: number, head: Float32Array): TrailOutput {
    this.flip = this.flip === 0 ? 1 : 0
    const out = this.bufs[this.flip]
    out.length = this.slots
    out.currentTime = nowMs - this.epoch
    if (this.slots === 0) return out
    out.path.set(this.histPath)
    out.timestamps.set(this.histTs)
    for (let k = 0; k < this.slots; k++) {
      const i = this.slotOf[k]
      const v = k * VERTS + HISTORY
      out.path[v * 3] = head[i * 3]
      out.path[v * 3 + 1] = head[i * 3 + 1]
      out.path[v * 3 + 2] = head[i * 3 + 2]
      out.timestamps[v] = out.currentTime
    }
    return out
  }
}
