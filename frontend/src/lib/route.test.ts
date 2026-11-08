import { describe, expect, it } from 'vitest'
import { clamp01, easeInOut, partialRoute, pointAlong, routeLength } from './route'

// Points on a line of constant longitude 1 degree of latitude apart is far too long; use small steps.
const A = { lat: 53.5, lon: -113.5 }
const B = { lat: 53.51, lon: -113.5 }
const C = { lat: 53.51, lon: -113.49 }

describe('routeLength', () => {
  it('is the sum of the legs in metres', () => {
    expect(routeLength([A, B])).toBeGreaterThan(1000)
    expect(routeLength([A, B])).toBeLessThan(1200)
    expect(routeLength([A, B, C])).toBeGreaterThan(routeLength([A, B]))
    expect(routeLength([A])).toBe(0)
  })
})

describe('partialRoute', () => {
  it('starts at the start, ends exactly at the fraction, and keeps the corners it has passed', () => {
    expect(partialRoute([A, B], 0)).toEqual([A, A])
    expect(partialRoute([A, B], 1)).toEqual([A, B])
    const half = partialRoute([A, B], 0.5)
    expect(half).toHaveLength(2)
    expect(half[1].lat).toBeCloseTo((A.lat + B.lat) / 2, 6)
    // Past the first leg (which is ~1.1 km of ~1.7 km): the corner B is kept, then a point on the second leg.
    const late = partialRoute([A, B, C], 0.9)
    expect(late).toHaveLength(3)
    expect(late[1]).toEqual(B)
    expect(late[2].lat).toBeCloseTo(B.lat, 6)
    expect(late[2].lon).toBeGreaterThan(B.lon)
    expect(late[2].lon).toBeLessThan(C.lon)
  })
  it('is safe with too few points, repeated points and silly fractions', () => {
    expect(partialRoute([], 0.5)).toEqual([])
    expect(partialRoute([A], 0.5)).toEqual([A])
    expect(partialRoute([A, A], 0.5)).toEqual([A, A])
    expect(partialRoute([A, B], 7)).toEqual([A, B])
    expect(partialRoute([A, B], Number.NaN)).toEqual([A, A])
  })
})

describe('pointAlong and easing', () => {
  it('walks the route from start to end', () => {
    expect(pointAlong([A, B], 0)).toEqual(A)
    expect(pointAlong([A, B], 1)).toEqual(B)
    expect(pointAlong([], 0.5)).toBeNull()
  })
  it('eases in and out and stays inside 0..1', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOut(0.25)).toBeLessThan(0.25) // slow start
    expect(easeInOut(0.75)).toBeGreaterThan(0.75) // slow finish
    expect(clamp01(-3)).toBe(0)
    expect(clamp01(Number.NaN)).toBe(0)
  })
})
