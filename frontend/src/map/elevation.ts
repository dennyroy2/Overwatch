// Puts ghosts ON the terrain.
//
// deck.gl draws a point at z = 0 (sea level) unless told otherwise. Edmonton sits ~630 m up and the
// map exaggerates terrain, so a ghost at z = 0 is buried over a kilometre below the surface. We
// can't ask MapLibre for 5,000-10,000 heights per frame, so we sample its own ground height
// (`queryTerrainElevation`, which already includes the exaggeration) on a COARSE GRID and
// bilinearly interpolate each ghost's height from that grid. Same source of truth as the visible
// ground, no second terrain copy. Decision recorded in DECISIONS.md.
//
// Building the grid costs ~60 us per node (a full 48x48 grid is ~140 ms). Done in one go that is a visible
// stall (step 18 measured 67 and 117 ms dropped frames, one right after an evidence beat), so after the
// first build everything runs in small time-budgeted slices from the animation-frame loop (`step`) while
// the old grid keeps serving ghosts, then swaps in.
import type { Map as MapLibreMap } from 'maplibre-gl'
import { lonLatToLngLat, metresToDegrees } from '@/lib/geo'
import { FLOATS_PER_GHOST, OFFSET } from '@/stream/ghostBuffer'

/** Lift above the ground so dots don't z-fight with the surface. */
export const LIFT_M = 3
const CELL_M = 120
/** A full build queries MapLibre once per node (~60 us each), so the grid is capped. */
const MAX_CELLS_PER_AXIS = 48
const MARGIN_M = 600
/** When ghosts outgrow the grid, rebuild this much bigger than needed so it happens rarely. */
const GROWTH_HEADROOM = 0.5
/** Slices always make progress, even with a zero budget. */
const MIN_NODES_PER_STEP = 16

interface Grid {
  minLon: number
  minLat: number
  dLon: number
  dLat: number
  nx: number
  ny: number
  z: Float32Array
  ready: boolean
  /** Node indices whose terrain tile wasn't loaded yet; re-queried (only these) when tiles arrive. */
  holes: number[]
}

export interface GroundStats {
  rebuilds: number
  refills: number
  /** Nodes still to query in a build in progress (0 = idle). */
  pendingNodes: number
  /** Longest single slice of grid work, ms (should stay a few ms). */
  maxSliceMs: number
  holes: number
  lastBuildMs: number
  nodes: number
  validNodes: number
}

export interface GroundSampler {
  /** Writes `z` into every slot of `buf` (first `count` slots). Starts a grid build if the swarm outgrew the grid. */
  apply(buf: Float32Array, count: number): void
  /** Do up to `budgetMs` of pending grid work (a build or a hole refill). Call every animation frame. */
  step(budgetMs: number): void
  /** True once after a new grid replaced the old one: re-run `apply` so ghosts pick up the new heights. */
  takeSwapped(): boolean
  /** New terrain tiles may have loaded: refill any missing nodes on the next frame (throttled). */
  markStale(): void
  stats(): GroundStats
}

/** A grid being built a slice at a time; it replaces the live grid only when complete. */
interface Pending {
  minLon: number
  minLat: number
  dLon: number
  dLat: number
  nx: number
  ny: number
  z: Float32Array
  holes: number[]
  /** Next node (row-major) to query. */
  next: number
  sum: number
  startedAt: number
}

export function createGroundSampler(map: MapLibreMap): GroundSampler {
  let grid: Grid | null = null
  let pending: Pending | null = null
  let swapped = false
  /** New terrain tiles may have loaded since we last tried the missing nodes. */
  let stale = false
  /** Holes waiting to be re-queried, and how far through them we are (a refill in progress). */
  let refillQueue: number[] = []
  let refillPos = 0
  let refillFresh: number[] = []
  const st: GroundStats = { rebuilds: 0, refills: 0, pendingNodes: 0, maxSliceMs: 0, holes: 0, lastBuildMs: 0, nodes: 0, validNodes: 0 }

  function query(longitude: number, latitude: number): number | null {
    const h = map.queryTerrainElevation(lonLatToLngLat([longitude, latitude]))
    return typeof h === 'number' && Number.isFinite(h) ? h : null
  }

  function startBuild(minLon: number, maxLon: number, minLat: number, maxLat: number): void {
    const { dLat: cellLat, dLon: cellLon } = metresToDegrees(CELL_M, (minLat + maxLat) / 2)
    const nx = Math.min(MAX_CELLS_PER_AXIS, Math.ceil((maxLon - minLon) / cellLon) + 1)
    const ny = Math.min(MAX_CELLS_PER_AXIS, Math.ceil((maxLat - minLat) / cellLat) + 1)
    pending = {
      minLon, minLat,
      dLon: nx > 1 ? (maxLon - minLon) / (nx - 1) : cellLon,
      dLat: ny > 1 ? (maxLat - minLat) / (ny - 1) : cellLat,
      nx, ny,
      z: new Float32Array(nx * ny),
      holes: [],
      next: 0,
      sum: 0,
      startedAt: performance.now(),
    }
    st.pendingNodes = nx * ny
    // The very first grid is built at once (the swarm is tiny then, ~4 ms) so ghosts never start buried.
    if (!grid) work(Infinity)
  }

  /** Query pending nodes until the time budget is spent. Returns true if a build finished. */
  function work(budgetMs: number): boolean {
    const p = pending
    if (!p) return false
    const t0 = performance.now()
    const total = p.nx * p.ny
    let doneAtLeast = 0
    while (p.next < total) {
      const idx = p.next++
      const h = query(p.minLon + (idx % p.nx) * p.dLon, p.minLat + Math.floor(idx / p.nx) * p.dLat)
      if (h === null) p.holes.push(idx) // tile not loaded yet
      else { p.z[idx] = h; p.sum += h }
      doneAtLeast += 1
      // Check the clock every few nodes; always make a little progress even with a zero budget.
      if (doneAtLeast >= MIN_NODES_PER_STEP && (doneAtLeast & 7) === 0 && performance.now() - t0 >= budgetMs) break
    }
    st.maxSliceMs = Math.max(st.maxSliceMs, performance.now() - t0)
    st.pendingNodes = total - p.next
    if (p.next < total) return false
    // Finished: fill holes with the mean of what we know (better than burying them at 0), and swap in.
    const valid = total - p.holes.length
    const mean = valid > 0 ? p.sum / valid : 0
    for (const k of p.holes) p.z[k] = mean
    grid = { minLon: p.minLon, minLat: p.minLat, dLon: p.dLon, dLat: p.dLat, nx: p.nx, ny: p.ny, z: p.z, ready: valid > 0, holes: p.holes }
    refillQueue = p.holes.slice()
    refillPos = 0
    refillFresh = []
    st.rebuilds += 1
    st.lastBuildMs = performance.now() - p.startedAt // wall time, across all slices
    st.nodes = total
    st.validNodes = valid
    st.holes = p.holes.length
    pending = null
    swapped = true
    return true
  }

  /** Re-query ONLY the nodes that were missing, in slices. */
  function refillWork(budgetMs: number): void {
    const g = grid
    if (!g || refillPos >= refillQueue.length) return
    const t0 = performance.now()
    let n = 0
    while (refillPos < refillQueue.length) {
      const k = refillQueue[refillPos++]
      const h = query(g.minLon + (k % g.nx) * g.dLon, g.minLat + Math.floor(k / g.nx) * g.dLat)
      if (h === null) refillFresh.push(k)
      else { g.z[k] = h; g.ready = true; swapped = true }
      n += 1
      if (n >= MIN_NODES_PER_STEP && (n & 7) === 0 && performance.now() - t0 >= budgetMs) break
    }
    st.maxSliceMs = Math.max(st.maxSliceMs, performance.now() - t0)
    if (refillPos >= refillQueue.length) {
      // This pass is over: whatever is still missing becomes the next pass's queue.
      g.holes = refillFresh
      refillQueue = refillFresh
      refillFresh = []
      refillPos = 0
      st.refills += 1
      st.holes = g.holes.length
      st.validNodes = g.nx * g.ny - g.holes.length
      // Wait for new terrain tiles (markStale) before trying the leftovers again.
      stale = false
    }
  }

  function step(budgetMs: number): void {
    if (pending) work(budgetMs)
    else if (stale && grid && refillQueue.length > 0) refillWork(budgetMs)
  }

  function apply(buf: Float32Array, count: number): void {
    if (count === 0) return
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS_PER_GHOST
      const lon = buf[o + OFFSET.longitude]
      const lat = buf[o + OFFSET.latitude]
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    const gridCovers = (g: { minLon: number; minLat: number; dLon: number; dLat: number; nx: number; ny: number }) =>
      minLon >= g.minLon && minLat >= g.minLat && maxLon <= g.minLon + (g.nx - 1) * g.dLon && maxLat <= g.minLat + (g.ny - 1) * g.dLat
    // Outside the live grid AND not already being covered by the build in progress: start (or restart bigger).
    if ((!grid || !gridCovers(grid)) && !(pending && gridCovers(pending))) {
      const { dLat, dLon } = metresToDegrees(MARGIN_M, (minLat + maxLat) / 2)
      // Headroom: ghosts spread over time, so build bigger than needed to avoid rebuilding every few frames.
      const padLon = dLon + (maxLon - minLon) * GROWTH_HEADROOM
      const padLat = dLat + (maxLat - minLat) * GROWTH_HEADROOM
      startBuild(minLon - padLon, maxLon + padLon, minLat - padLat, maxLat + padLat)
    }
    const g = grid
    if (!g || !g.ready) return // leave z = 0 until the terrain tiles have loaded
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS_PER_GHOST
      // Ghosts just outside a not-yet-swapped grid use its nearest edge height for a moment (clamped).
      const fx = Math.min(g.nx - 1, Math.max(0, (buf[o + OFFSET.longitude] - g.minLon) / g.dLon))
      const fy = Math.min(g.ny - 1, Math.max(0, (buf[o + OFFSET.latitude] - g.minLat) / g.dLat))
      const x0 = Math.min(g.nx - 2 < 0 ? 0 : g.nx - 2, Math.floor(fx))
      const y0 = Math.min(g.ny - 2 < 0 ? 0 : g.ny - 2, Math.floor(fy))
      const x1 = Math.min(g.nx - 1, x0 + 1)
      const y1 = Math.min(g.ny - 1, y0 + 1)
      const tx = fx - x0
      const ty = fy - y0
      const a = g.z[y0 * g.nx + x0]
      const b = g.z[y0 * g.nx + x1]
      const c = g.z[y1 * g.nx + x0]
      const d = g.z[y1 * g.nx + x1]
      buf[o + OFFSET.elevation] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty + LIFT_M
    }
  }

  return {
    apply,
    step,
    takeSwapped: () => { const v = swapped; swapped = false; return v },
    markStale: () => { stale = true },
    stats: () => ({ ...st }),
  }
}
