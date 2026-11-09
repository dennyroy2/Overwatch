import { describe, expect, it } from 'vitest'
import { MIN_FRAME_SPAN_M, framePoints } from './attributionFrame'
import { distanceMetres } from './geo'

const arr = (pts: [number, number][]) => Float32Array.from(pts.flatMap(([lon, lat]) => [lon, lat, 0]))

describe('framePoints', () => {
  it('covers both where the cloud was removed and where it arrived, plus the card\'s own place', () => {
    const removed = arr([[-113.53, 53.54], [-113.52, 53.545], [-113.525, 53.55]]) // downtown
    const arrived = arr([[-113.54, 53.53], [-113.538, 53.532]]) // the river valley
    const place = { lat: 53.533, lon: -113.539 }
    const pts = framePoints(removed, 3, arrived, 2, place)!
    const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat)
    // (positions are 32-bit floats, so compare with a small tolerance)
    expect(Math.min(...lons)).toBeLessThanOrEqual(-113.5399)
    expect(Math.max(...lons)).toBeGreaterThanOrEqual(-113.5201)
    expect(Math.min(...lats)).toBeLessThanOrEqual(53.5301)
    expect(Math.max(...lats)).toBeGreaterThanOrEqual(53.5499)
    expect(pts).toContainEqual(place)
  })

  it('ignores a lone straggler so one ghost cannot zoom the map out to the whole city', () => {
    const many = Array.from({ length: 200 }, (_, i): [number, number] => [-113.53 + (i % 10) * 0.0002, 53.54 + Math.floor(i / 10) * 0.0002])
    const withStray = arr([...many, [-112.5, 54.5]])
    const pts = framePoints(withStray, 201, new Float32Array(0), 0, { lat: 53.541, lon: -113.529 })
    const wide = distanceMetres({ lat: 53.5, lon: -113.5 }, { lat: 54.5, lon: -112.5 })
    expect(pts).not.toBeNull()
    const lons = pts!.map((p) => p.lon)
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(0.05)
    expect(wide).toBeGreaterThan(100_000) // the stray really was far away
  })

  it('returns null when nothing changed or the change is local, so the normal fly-to is used instead', () => {
    expect(framePoints(new Float32Array(0), 0, new Float32Array(0), 0, { lat: 53.5, lon: -113.5 })).toBeNull()
    const tight = arr([[-113.5, 53.5], [-113.4999, 53.5001], [-113.5001, 53.4999]])
    expect(framePoints(tight, 3, new Float32Array(0), 0, { lat: 53.5, lon: -113.5 })).toBeNull()
    expect(MIN_FRAME_SPAN_M).toBeGreaterThan(0)
  })

  it('a card whose own place is far from where the ghosts were is still framed', () => {
    const near = arr([[-113.5, 53.5], [-113.4999, 53.5001]])
    expect(framePoints(near, 2, new Float32Array(0), 0, { lat: 53.52, lon: -113.5 })).not.toBeNull()
  })
})
