import { describe, expect, it } from 'vitest'
import {
  degreesToMetres, distanceMetres, fromLngLat, fromLonLat, isInEdmonton, lngLatToLonLat, lonLatToLngLat,
  lerpPoint, metresToDegrees, offsetPoint, toLngLat, toLonLat, toLonLatPath,
} from './geo'

// 124 St & Jasper Ave, the demo last-seen point (backend EDMONTON_DEFAULT)
const JASPER_124 = { lat: 53.5422, lon: -113.5337 }

describe('geo conversions', () => {
  it('124 St & Jasper Ave converts to deck.gl [lon, lat] and lands in Edmonton', () => {
    const lonLat = toLonLat(JASPER_124)
    expect(lonLat).toEqual([-113.5337, 53.5422]) // longitude FIRST
    expect(isInEdmonton(fromLonLat(lonLat))).toBe(true)
  })

  it('round-trips GeoPoint <-> [lon, lat]', () => {
    expect(fromLonLat(toLonLat(JASPER_124))).toEqual(JASPER_124)
  })

  it('converts to MapLibre {lng, lat} and back', () => {
    expect(toLngLat(JASPER_124)).toEqual({ lng: -113.5337, lat: 53.5422 })
    expect(fromLngLat(toLngLat(JASPER_124))).toEqual(JASPER_124)
  })

  it('converts between deck.gl and MapLibre directly', () => {
    expect(lonLatToLngLat([-113.5337, 53.5422])).toEqual({ lng: -113.5337, lat: 53.5422 })
    expect(lngLatToLonLat({ lng: -113.5337, lat: 53.5422 })).toEqual([-113.5337, 53.5422])
  })

  it('a swapped lat/lon is detected as not in Edmonton (the Somalia bug)', () => {
    const swapped = { lat: JASPER_124.lon, lon: JASPER_124.lat }
    expect(isInEdmonton(swapped)).toBe(false)
  })

  it('maps point lists in order', () => {
    expect(toLonLatPath([JASPER_124, { lat: 53.5, lon: -113.5 }])).toEqual([[-113.5337, 53.5422], [-113.5, 53.5]])
  })
})

describe('metres and degrees at Edmonton latitude', () => {
  it('one degree of latitude is about 111 km', () => {
    const { east, north } = degreesToMetres(0, 1, 53.5422)
    expect(north).toBeCloseTo(111_320, 0)
    expect(east).toBe(0)
  })

  it('a degree of longitude is shorter than a degree of latitude (cos 53.5 deg ~ 0.595)', () => {
    const { east } = degreesToMetres(1, 0, 53.5422)
    expect(east / 111_320).toBeCloseTo(0.5945, 3)
  })

  it('round-trips metres -> degrees -> metres', () => {
    const { dLat, dLon } = metresToDegrees(500, 53.5422)
    const { east, north } = degreesToMetres(dLon, dLat, 53.5422)
    expect(east).toBeCloseTo(500, 6)
    expect(north).toBeCloseTo(500, 6)
  })

  it('offsetPoint moves east and north in the right directions and distance agrees', () => {
    const p = offsetPoint(JASPER_124, 300, 400)
    expect(p.lon).toBeGreaterThan(JASPER_124.lon) // east is +lon
    expect(p.lat).toBeGreaterThan(JASPER_124.lat) // north is +lat
    expect(distanceMetres(JASPER_124, p)).toBeCloseTo(500, 0)
    expect(isInEdmonton(p)).toBe(true)
  })
})

describe('lerpPoint', () => {
  it('moves part-way between two points and returns the ends at 0 and 1', () => {
    const a = { lat: 53.5, lon: -113.5 }
    const b = { lat: 53.6, lon: -113.3 }
    expect(lerpPoint(a, b, 0)).toEqual(a)
    expect(lerpPoint(a, b, 1)).toEqual(b)
    const mid = lerpPoint(a, b, 0.5)
    expect(mid.lat).toBeCloseTo(53.55, 6)
    expect(mid.lon).toBeCloseTo(-113.4, 6)
    expect(isInEdmonton(mid)).toBe(true)
  })
})

