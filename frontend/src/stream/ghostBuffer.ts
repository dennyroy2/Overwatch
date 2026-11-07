// Ghost positions live HERE, in plain typed arrays, never in React state.
// 5k to 10k points arriving ~5x/s through React is how you lose 60 fps (roadmap, step 8).
//
// Layout: [lon, lat, z, weight] per ghost slot (4 floats, 16 bytes), so slot i is always at offset 4*i.
// The wire format is [lon, lat, weight]; `z` (metres above sea level, already terrain-exaggerated)
// is filled in by the ground sampler (map/elevation.ts) and is 0 until then.
// deck.gl reads position as size 3 at stride 16 (lon, lat, z) and weight as size 1 at offset 12.
// Two buffers swap each frame so step 14 can interpolate previous -> current without copying.
// Coordinates here are deck.gl order [lon, lat]. Conversions elsewhere go through lib/geo.ts.

export const FLOATS_PER_GHOST = 4
export const GHOST_STRIDE_BYTES = FLOATS_PER_GHOST * 4
/** Float offsets inside one slot. */
export const OFFSET = { longitude: 0, latitude: 1, elevation: 2, weight: 3 } as const
const INITIAL_CAPACITY = 12_000

export interface GhostState {
  /** Two preallocated buffers; `cur` indexes the newest frame. */
  buffers: [Float32Array, Float32Array]
  cur: 0 | 1
  /** Ghost slots in the newest / previous frame. */
  count: number
  prevCount: number
  /** Total ghost frames received this session (debug HUD, tests). */
  frame: number
  /** Sim time of the newest frame, ms since epoch. */
  simTime: number
  /** performance.now() when the newest / previous frame arrived, for interpolation. */
  receivedAt: number
  prevReceivedAt: number
  /**
   * Slots whose ghost died and was replaced this frame (a NEW ghost, not a moved one).
   * Comes from `GhostFrame.respawned` (ask #1). null = field missing, see `allRespawned`.
   */
  respawned: Int32Array | null
  /**
   * Fallback until Rishaan's contract change merges: a missing `respawned` field means
   * "every slot respawned" on the first frame after an `evidence` message (the stub reshuffles
   * indices on resample). Once the field exists this is always false.
   */
  allRespawned: boolean
}

export const ghosts: GhostState = {
  buffers: [new Float32Array(INITIAL_CAPACITY * FLOATS_PER_GHOST), new Float32Array(INITIAL_CAPACITY * FLOATS_PER_GHOST)],
  cur: 0,
  count: 0,
  prevCount: 0,
  frame: 0,
  simTime: 0,
  receivedAt: 0,
  prevReceivedAt: 0,
  respawned: null,
  allRespawned: false,
}

let evidenceSinceLastFrame = false

type FrameListener = () => void
const frameListeners = new Set<FrameListener>()
/** Subscribe to "a new ghost frame is in the buffer". Outside React; returns an unsubscribe. */
export function onGhostFrame(fn: FrameListener): () => void {
  frameListeners.add(fn)
  return () => frameListeners.delete(fn)
}

export const currentBuffer = (): Float32Array => ghosts.buffers[ghosts.cur]
export const previousBuffer = (): Float32Array => ghosts.buffers[ghosts.cur === 0 ? 1 : 0]

/** Call whenever an `evidence` message is applied; drives the allRespawned fallback. */
export function noteEvidence(): void {
  evidenceSinceLastFrame = true
}

/**
 * `respawned` is not in the generated contract types yet (ask #1). Read it defensively so the
 * same code works before and after Rishaan's change. After he merges and `make types` runs,
 * `frame.respawned` is typed and this helper can read it directly.
 */
export function readRespawned(frame: object): number[] | undefined {
  const r = (frame as { respawned?: unknown }).respawned
  return Array.isArray(r) ? (r as number[]) : undefined
}

function ensureCapacity(slots: number): void {
  if (slots * FLOATS_PER_GHOST <= ghosts.buffers[0].length) return
  const size = Math.ceil((slots * 1.25) * FLOATS_PER_GHOST)
  // Growing drops the previous frame for one tick; the interpolator treats that as "no previous".
  ghosts.buffers = [new Float32Array(size), new Float32Array(size)]
  ghosts.prevCount = 0
}

/** Write one frame's positions ([[lon, lat, weight], ...]) into the next buffer. No allocation in the hot path. */
export function pushFrame(positions: number[][], simTimeIso: string, respawned: number[] | undefined): void {
  ensureCapacity(positions.length)
  ghosts.prevCount = ghosts.count
  ghosts.prevReceivedAt = ghosts.receivedAt
  ghosts.cur = ghosts.cur === 0 ? 1 : 0
  const buf = ghosts.buffers[ghosts.cur]
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]
    const o = i * FLOATS_PER_GHOST
    buf[o + OFFSET.longitude] = p[0]
    buf[o + OFFSET.latitude] = p[1]
    buf[o + OFFSET.elevation] = 0
    buf[o + OFFSET.weight] = p[2] ?? 1
  }
  ghosts.count = positions.length
  ghosts.receivedAt = performance.now()
  ghosts.simTime = Date.parse(simTimeIso)
  if (respawned) {
    ghosts.respawned = Int32Array.from(respawned)
    ghosts.allRespawned = false
  } else {
    ghosts.respawned = null
    ghosts.allRespawned = evidenceSinceLastFrame
  }
  evidenceSinceLastFrame = false
  ghosts.frame += 1
  for (const fn of frameListeners) fn()
}

/** Forget all ghost data (new case, or the server lost the case). */
export function resetGhosts(): void {
  ghosts.count = 0
  ghosts.prevCount = 0
  ghosts.frame = 0
  ghosts.simTime = 0
  ghosts.receivedAt = 0
  ghosts.prevReceivedAt = 0
  ghosts.respawned = null
  ghosts.allRespawned = false
  evidenceSinceLastFrame = false
  // Listeners clear their layers when the buffer empties (case closed).
  for (const fn of frameListeners) fn()
}
