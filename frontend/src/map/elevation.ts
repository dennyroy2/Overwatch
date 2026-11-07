// Puts ghosts ON the terrain.
//
// deck.gl draws a point at z = 0 (sea level) unless told otherwise. Edmonton sits ~630 m up and the
// map exaggerates terrain, so a ghost at z = 0 is buried over a kilometre below the surface. We
// can't ask MapLibre for 5,000-10,000 heights per frame, so we sample its own ground height
// (`queryTerrainElevation`, which already includes the exaggeration) on a COARSE GRID and
// bilinearly interpolate each ghost's height from that grid. Same source of truth as the visible
// ground, no second terrain copy. Decision recorded in DECISIONS.md.
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
const MIN_REBUILD_MS = 500

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
  holes: number
  lastBuildMs: number
  nodes: number
  validNodes: number
}

export interface GroundSampler {
  /** Writes `z` into every slot of `buf` (first `count` slots). */
  apply(buf: Float32Array, count: number): void
  /** New terrain tiles may have loaded: refill any missing nodes on the next frame (throttled). */
  markStale(): void
  stats(): GroundStats
}

export function createGroundSampler(map: MapLibreMap): GroundSampler {
  let grid: Grid | null = null
  let stale = false
  let lastBuild = 0
  const st: GroundStats = { rebuilds: 0, refills: 0, holes: 0, lastBuildMs: 0, nodes: 0, validNodes: 0 }

  function build(minLon: number, maxLon: number, minLat: number, maxLat: number): void {
    const t0 = performance.now()
    const { dLat: cellLat, dLon: cellLon } = metresToDegrees(CELL_M, (minLat + maxLat) / 2)
    const nx = Math.min(MAX_CELLS_PER_AXIS, Math.ceil((maxLon - minLon) / cellLon) + 1)
    const ny = Math.min(MAX_CELLS_PER_AXIS, Math.ceil((maxLat - minLat) / cellLat) + 1)
    const dLon = nx > 1 ? (maxLon - minLon) / (nx - 1) : cellLon
    const dLat = ny > 1 ? (maxLat - minLat) / (ny - 1) : cellLat
    const z = new Float32Array(nx * ny)
    const holes: number[] = []
    let sum = 0
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const h = query(minLon + i * dLon, minLat + j * dLat)
        if (h === null) holes.push(j * nx + i) // tile not loaded yet
        else { z[j * nx + i] = h; sum += h }
      }
    }
    const valid = nx * ny - holes.length
    // Until holes are refilled, use the mean of what we know (better than burying them at 0).
    const mean = valid > 0 ? sum / valid : 0
    for (const k of holes) z[k] = mean
    grid = { minLon, minLat, dLon, dLat, nx, ny, z, ready: valid > 0, holes }
    stale = holes.length > 0 // retry soon if tiles were missing
    lastBuild = performance.now()
    st.rebuilds += 1
    st.lastBuildMs = lastBuild - t0
    st.nodes = nx * ny
    st.validNodes = valid
    st.holes = holes.length
  }

  /** Re-query ONLY the nodes that were missing. Cheap compared with a rebuild. */
  function refill(g: Grid): void {
    const still: number[] = []
    for (const k of g.holes) {
      const h = query(g.minLon + (k % g.nx) * g.dLon, g.minLat + Math.floor(k / g.nx) * g.dLat)
      if (h === null) still.push(k)
      else { g.z[k] = h; g.ready = true }
    }
    g.holes = still
    stale = still.length > 0
    lastBuild = performance.now()
    st.refills += 1
    st.holes = still.length
    st.validNodes = g.nx * g.ny - still.length
  }

  function query(longitude: number, latitude: number): number | null {
    const h = map.queryTerrainElevation(lonLatToLngLat([longitude, latitude]))
    return typeof h === 'number' && Number.isFinite(h) ? h : null
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
    const now = performance.now()
    const outside = !grid || minLon < grid.minLon || minLat < grid.minLat ||
      maxLon > grid.minLon + (grid.nx - 1) * grid.dLon || maxLat > grid.minLat + (grid.ny - 1) * grid.dLat
    if (outside) {
      const { dLat, dLon } = metresToDegrees(MARGIN_M, (minLat + maxLat) / 2)
      // Headroom: ghosts spread over time, so build bigger than needed to avoid rebuilding every few frames.
      const padLon = dLon + (maxLon - minLon) * GROWTH_HEADROOM
      const padLat = dLat + (maxLat - minLat) * GROWTH_HEADROOM
      build(minLon - padLon, maxLon + padLon, minLat - padLat, maxLat + padLat)
    } else if (stale && grid && grid.holes.length > 0 && now - lastBuild > MIN_REBUILD_MS) {
      refill(grid)
    }
    const g = grid
    if (!g || !g.ready) return // leave z = 0 until the terrain tiles have loaded
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS_PER_GHOST
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

  return { apply, markStale: () => { stale = true }, stats: () => ({ ...st }) }
}
