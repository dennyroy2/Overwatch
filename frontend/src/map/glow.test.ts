import { describe, expect, it } from 'vitest'
import { FLOATS_PER_GHOST, OFFSET } from '@/stream/ghostBuffer'
import { offsetPoint } from '@/lib/geo'
import {
  CORE_OPACITY, GlowEase, HALO_OPACITY, TARGET_TYPICAL_LIGHT, coreOpacityForDensity, densityStats, haloOpacityForDensity,
} from './glow'

const ORIGIN = { lat: 53.5422, lon: -113.5337 }

/** Ghosts placed `east`/`north` metres from the origin, in ghostBuffer layout. */
function ghostsAt(offsets: [number, number][]): Float32Array {
  const buf = new Float32Array(offsets.length * FLOATS_PER_GHOST)
  offsets.forEach(([e, n], i) => {
    const p = offsetPoint(ORIGIN, e, n)
    buf[i * FLOATS_PER_GHOST + OFFSET.longitude] = p.lon
    buf[i * FLOATS_PER_GHOST + OFFSET.latitude] = p.lat
  })
  return buf
}

describe('densityStats', () => {
  it('reports the busiest cell and the typical occupied cell', () => {
    const packed: [number, number][] = Array.from({ length: 50 }, (_, i) => [(i % 5) * 2, Math.floor(i / 5) * 2]) // 50 ghosts within ~20 m
    const spread: [number, number][] = Array.from({ length: 20 }, (_, i) => [500 + i * 200, 500]) // 20 ghosts, 200 m apart
    const { peak, meanOccupied } = densityStats(ghostsAt([...packed, ...spread]), 70)
    expect(peak).toBeGreaterThanOrEqual(45)
    expect(peak).toBeLessThanOrEqual(50)
    // 70 ghosts over ~21 occupied cells: one packed cell plus 20 singles
    expect(meanOccupied).toBeGreaterThan(2.5)
    expect(meanOccupied).toBeLessThan(4)
  })

  it('a uniform swarm has peak close to typical (no hot spot), a clustered one does not', () => {
    const uniform: [number, number][] = Array.from({ length: 400 }, (_, i) => [(i % 20) * 45, Math.floor(i / 20) * 45])
    const u = densityStats(ghostsAt(uniform), 400)
    expect(u.peak / u.meanOccupied).toBeLessThan(2)
    const clustered: [number, number][] = [...uniform.slice(0, 200), ...Array.from({ length: 200 }, (_, i) => [(i % 4) * 3, Math.floor(i / 4) * 3] as [number, number])]
    const c = densityStats(ghostsAt(clustered), 400)
    expect(c.peak / c.meanOccupied).toBeGreaterThan(5)
  })

  it('is 1 when ghosts are all far apart, and zeros for an empty frame', () => {
    const apart: [number, number][] = Array.from({ length: 10 }, (_, i) => [i * 500, 0])
    expect(densityStats(ghostsAt(apart), 10)).toEqual({ peak: 1, meanOccupied: 1 })
    expect(densityStats(new Float32Array(0), 0)).toEqual({ peak: 0, meanOccupied: 0 })
  })

  it('copes with a swarm far wider than the grid (cells grow instead of overflowing)', () => {
    const wide: [number, number][] = Array.from({ length: 2000 }, (_, i) => [(i % 50) * 3000, Math.floor(i / 50) * 3000]) // ~150 km
    const { peak, meanOccupied } = densityStats(ghostsAt(wide), 2000)
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThanOrEqual(2000)
    expect(meanOccupied).toBeGreaterThanOrEqual(1)
  })
})

describe('glow normalisation', () => {
  it('a packed swarm dims the glow and a spread one brightens it, within the limits', () => {
    expect(haloOpacityForDensity(500)).toBeLessThan(haloOpacityForDensity(20))
    expect(haloOpacityForDensity(20)).toBeLessThan(haloOpacityForDensity(2))
    for (const mean of [0, 1, 5, 50, 500, 50_000]) {
      const h = haloOpacityForDensity(mean)
      expect(h).toBeGreaterThanOrEqual(HALO_OPACITY.min)
      expect(h).toBeLessThanOrEqual(HALO_OPACITY.max)
    }
  })

  it('keeps a typical occupied cell at about the target light whenever it is not clamped', () => {
    for (const mean of [4, 10, 40, 100]) {
      const light = haloOpacityForDensity(mean) * (Math.PI / 6) * mean
      expect(light).toBeCloseTo(TARGET_TYPICAL_LIGHT, 1)
    }
  })

  it('a hot spot reads hotter than typical: 3x the density gives ~3x the light at the same opacity', () => {
    const typical = 8
    const opacity = haloOpacityForDensity(typical)
    const lightTypical = opacity * (Math.PI / 6) * typical
    const lightHot = opacity * (Math.PI / 6) * typical * 3
    expect(lightHot / lightTypical).toBeCloseTo(3, 5)
    expect(lightHot).toBeGreaterThan(1.5) // red and green saturated: the cores' warm white takes over
  })

  it('cores dim in a packed swarm but never vanish', () => {
    expect(coreOpacityForDensity(5000)).toBeGreaterThanOrEqual(CORE_OPACITY.min)
    expect(coreOpacityForDensity(5000)).toBeLessThan(coreOpacityForDensity(2))
    expect(coreOpacityForDensity(2)).toBeLessThanOrEqual(CORE_OPACITY.max)
  })

  it('eases toward a new target without jumping, in either direction', () => {
    const g = new GlowEase(350)
    g.setDensity(5)
    g.step(1000)
    const bright = g.halo
    g.setDensity(500) // swarm just got much denser
    g.step(1016)
    expect(g.halo).toBeLessThan(bright)
    expect(g.halo).toBeGreaterThan(haloOpacityForDensity(500)) // not there yet: eased
    for (let t = 1032; t < 4000; t += 16) g.step(t)
    expect(g.halo).toBeCloseTo(haloOpacityForDensity(500), 3)
  })

  it('starts at the first frame\'s level instead of easing in from the default', () => {
    const g = new GlowEase()
    g.setDensity(500)
    expect(g.halo).toBeCloseTo(haloOpacityForDensity(500), 6)
  })
})
