// Auto-normalised glow ("warmth means probability", step 15).
//
// Additive light adds up linearly, but ghost density varies ~100x: a freshly spawned swarm is packed into
// ~150 m while a spread one covers kilometres. A fixed brightness would white out the first and starve the
// second. So each data frame we measure the TYPICAL local density (mean ghosts per occupied ~halo-sized
// cell) and scale the glow so a typical cell glows amber; only cells denser than typical climb to white.
// Warmth therefore means "denser than the rest of the swarm", not merely "dense": a uniform swarm stays
// amber and a collapse onto evidence turns that place white-hot while the rest dims. (Normalising to the
// PEAK instead whitened an entire uniform swarm, which is why we use the typical cell.)
import { metresToDegrees } from '@/lib/geo'
import { FLOATS_PER_GHOST, OFFSET } from '@/stream/ghostBuffer'

/** Density cell size, about one halo radius. */
export const CELL_METRES = 45
const MAX_CELLS_PER_AXIS = 128
const scratch = new Uint16Array(MAX_CELLS_PER_AXIS * MAX_CELLS_PER_AXIS)

export interface DensityStats {
  /** Ghosts in the busiest cell. */
  peak: number
  /** Mean ghosts per OCCUPIED cell: the swarm's typical local density. */
  meanOccupied: number
}

/** Local density of a frame. Cells grow if the swarm is too wide for the grid. Empty frame -> zeros. */
export function densityStats(buf: Float32Array, count: number, cellMetres = CELL_METRES): DensityStats {
  if (count === 0) return { peak: 0, meanOccupied: 0 }
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_GHOST
    const lo = buf[o + OFFSET.longitude]
    const la = buf[o + OFFSET.latitude]
    if (lo < minLon) minLon = lo
    if (lo > maxLon) maxLon = lo
    if (la < minLat) minLat = la
    if (la > maxLat) maxLat = la
  }
  const { dLat, dLon } = metresToDegrees(cellMetres, (minLat + maxLat) / 2)
  const cellLon = Math.max(dLon, (maxLon - minLon) / (MAX_CELLS_PER_AXIS - 1))
  const cellLat = Math.max(dLat, (maxLat - minLat) / (MAX_CELLS_PER_AXIS - 1))
  const nx = Math.floor((maxLon - minLon) / cellLon) + 1
  const ny = Math.floor((maxLat - minLat) / cellLat) + 1
  scratch.fill(0, 0, nx * ny)
  let peak = 0
  let occupied = 0
  for (let i = 0; i < count; i++) {
    const o = i * FLOATS_PER_GHOST
    const x = Math.floor((buf[o + OFFSET.longitude] - minLon) / cellLon)
    const y = Math.floor((buf[o + OFFSET.latitude] - minLat) / cellLat)
    const c = ++scratch[y * nx + x]
    if (c === 1) occupied++
    if (c > peak) peak = c
  }
  return { peak, meanOccupied: count / occupied }
}

/**
 * Light summed in a TYPICAL occupied cell, in LINEAR light (the map framebuffer gamma-encodes on display;
 * see GHOST_RGB_LINEAR). Linear amber is (1.0, 0.43, 0.05) per unit of light, so ~0.55 displays as deep
 * amber (about 200, 120, 40), and a cell 3x denser than typical sums to ~1.65 where red and green
 * saturate and the cores' warm white takes over: hot. History: 1.3 then 0.8 were tried and read
 * yellow-white across a whole uniform swarm. The user asked for a strong layer that drives the picture;
 * deep amber at typical density with white-hot concentrations is that, with range left to spend.
 */
export const TARGET_TYPICAL_LIGHT = 0.55
/** Average of (1 - d)^2 over a disc is 1/6, so a halo covers ~pi/6 of one cell-sized area's worth of light per ghost. */
const LIGHT_PER_GHOST = Math.PI / 6

export const HALO_OPACITY = { min: 0.008, max: 0.6 } as const
export const CORE_OPACITY = { min: 0.14, max: 0.95 } as const

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

/** Halo opacity that makes a typical occupied cell sum to about TARGET_TYPICAL_LIGHT. */
export function haloOpacityForDensity(meanOccupied: number): number {
  if (meanOccupied <= 0) return HALO_OPACITY.max
  return clamp(TARGET_TYPICAL_LIGHT / (LIGHT_PER_GHOST * meanOccupied), HALO_OPACITY.min, HALO_OPACITY.max)
}

/** Cores dim too in a packed swarm (so it doesn't white out) but never vanish: single ghosts stay readable. */
export function coreOpacityForDensity(meanOccupied: number): number {
  const halo = haloOpacityForDensity(meanOccupied)
  const t = (halo - HALO_OPACITY.min) / (HALO_OPACITY.max - HALO_OPACITY.min)
  return CORE_OPACITY.min + (CORE_OPACITY.max - CORE_OPACITY.min) * Math.sqrt(clamp(t, 0, 1))
}

/**
 * Eases the opacities toward the latest targets so a new frame can't make the glow flicker.
 * Frame-rate independent; time-constant in ms.
 */
export class GlowEase {
  halo: number = HALO_OPACITY.max
  core: number = CORE_OPACITY.max
  private targetHalo: number = HALO_OPACITY.max
  private targetCore: number = CORE_OPACITY.max
  private last = 0
  private seeded = false
  private readonly tauMs: number

  constructor(tauMs = 350) {
    this.tauMs = tauMs
  }

  setDensity(meanOccupied: number): void {
    this.targetHalo = haloOpacityForDensity(meanOccupied)
    this.targetCore = coreOpacityForDensity(meanOccupied)
    if (!this.seeded && meanOccupied > 0) {
      this.halo = this.targetHalo // first frame: no ease from the default
      this.core = this.targetCore
      this.seeded = true
    }
  }

  step(nowMs: number): void {
    const dt = this.last ? Math.min(250, nowMs - this.last) : 0
    this.last = nowMs
    // Ease in log space for the halo: it spans 2 orders of magnitude, so a linear ease would look jumpy.
    const k = 1 - Math.exp(-dt / this.tauMs)
    this.halo = Math.exp(Math.log(this.halo) + (Math.log(this.targetHalo) - Math.log(this.halo)) * k)
    this.core += (this.targetCore - this.core) * k
  }

  reset(): void {
    this.halo = HALO_OPACITY.max
    this.core = CORE_OPACITY.max
    this.targetHalo = HALO_OPACITY.max
    this.targetCore = CORE_OPACITY.max
    this.last = 0
    this.seeded = false
  }
}
