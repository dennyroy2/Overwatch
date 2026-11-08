import { describe, expect, it } from 'vitest'
import { distanceMetres } from '@/lib/geo'
import {
  AREA_KINDS, PARSE_MS, PIN_KINDS, areaPolygon, cardText, circlePolygon, focusPoint, isAiText, isParsing, isPlainNote, visibleAt, mediaSrc,
} from './evidence'
import type { Evidence } from '@/types'

const P = { lat: 53.5422, lon: -113.5337 }
const ev = (over: Partial<Evidence> = {}): Evidence => ({
  id: 'e1', case_id: 'c', kind: 'note', source: 'officer', time: '2026-01-01T00:00:00Z', summary: 'x', reliability: 0.7, confirmed: false, ...over,
} as Evidence)

describe('plain notes and parsing', () => {
  it('a note with no place is plain; once it has a place or a structured kind it is not', () => {
    expect(isPlainNote(ev())).toBe(true)
    expect(isPlainNote(ev({ location: P }))).toBe(false)
    expect(isPlainNote(ev({ kind: 'sighting' }))).toBe(false)
    expect(isPlainNote(ev({ area: [P, P, P] }))).toBe(false)
  })

  it('shows Parsing for an officer note for PARSE_MS, then settles to a plain note', () => {
    const e = ev()
    expect(isParsing(e, 1000, 1000 + PARSE_MS - 1)).toBe(true)
    expect(isParsing(e, 1000, 1000 + PARSE_MS)).toBe(false)
  })

  it('never shows Parsing for other sources, or once structured', () => {
    expect(isParsing(ev({ source: 'family' }), 0, 100)).toBe(false)
    expect(isParsing(ev({ kind: 'sighting', location: P }), 0, 100)).toBe(false)
  })

  it('a plain note shows exactly what was typed', () => {
    expect(cardText(ev({ raw_text: 'Bus driver saw her', summary: 'ignored' }))).toBe('Bus driver saw her')
    expect(cardText(ev({ kind: 'sighting', location: P, raw_text: 'raw', summary: 'Sighting at the river valley stop' }))).toBe('Sighting at the river valley stop')
  })
})

describe('AI text is cyan only when the AI wrote it', () => {
  it('drone detections and tips the AI structured are AI text; typed notes and human sources are not', () => {
    expect(isAiText(ev({ source: 'drone_ai', kind: 'clue' }))).toBe(true)
    expect(isAiText(ev({ kind: 'sighting', raw_text: 'bus driver tip' }))).toBe(true)
    expect(isAiText(ev({ kind: 'note', raw_text: 'bus driver tip' }))).toBe(false)
    expect(isAiText(ev({ source: 'family', kind: 'favourite_place' }))).toBe(false)
  })
})

describe('map shapes', () => {
  it('a circle ring is closed and its points are the radius from the centre', () => {
    const ring = circlePolygon(P, 400)
    expect(ring[0]).toEqual(ring.at(-1))
    for (const p of ring) expect(distanceMetres(P, p)).toBeCloseTo(400, -1)
  })

  it('searched areas hatch their own polygon, else a circle from location and radius', () => {
    const tri = [P, { lat: P.lat + 0.001, lon: P.lon }, { lat: P.lat, lon: P.lon + 0.001 }]
    const own = areaPolygon(ev({ kind: 'searched_area', area: tri }))
    expect(own).toHaveLength(4) // closed
    const circ = areaPolygon(ev({ kind: 'searched_area', location: P, radius_m: 300 }))
    expect(circ?.length).toBeGreaterThan(8)
    expect(areaPolygon(ev({ kind: 'searched_area' }))).toBeNull()
    expect(areaPolygon(ev({ kind: 'sighting', location: P }))).toBeNull() // pins are not areas
  })

  it('pins and areas are disjoint sets of kinds', () => {
    for (const k of PIN_KINDS) expect(AREA_KINDS).not.toContain(k)
  })

  it('the camera focuses on a location, else the first corner of an area, else nowhere', () => {
    expect(focusPoint(ev({ location: P }))).toEqual(P)
    expect(focusPoint(ev({ area: [P, P, P] }))).toEqual(P)
    expect(focusPoint(ev())).toBeNull()
  })
})

describe('visibleAt (cards and pins follow the replay time)', () => {
  it('live shows everything', () => {
    expect(visibleAt(null, 5000)).toBe(true)
    expect(visibleAt({ mode: 'live', t: 100 }, 5000)).toBe(true)
  })
  it('a paused moment shows only what had arrived by then; unknown arrival is always shown', () => {
    expect(visibleAt({ mode: 'paused', t: 4000 }, 5000)).toBe(false)
    expect(visibleAt({ mode: 'paused', t: 6000 }, 5000)).toBe(true)
    expect(visibleAt({ mode: 'playing', t: 4000 }, undefined)).toBe(true)
    expect(visibleAt({ mode: 'paused', t: null }, 5000)).toBe(true)
  })
})

describe('mediaSrc', () => {
  it('uses a path on this site or an http(s) address', () => {
    expect(mediaSrc({ media_url: '/crops/ev_margaret_drone2_8_0.jpg' })).toBe('/crops/ev_margaret_drone2_8_0.jpg')
    expect(mediaSrc({ media_url: ' https://example.org/a.jpg ' })).toBe('https://example.org/a.jpg')
    expect(mediaSrc({ media_url: 'http://localhost:8000/c.png' })).toBe('http://localhost:8000/c.png')
  })

  it('ignores nothing, blanks and anything that is not an image address', () => {
    for (const bad of [undefined, null, '', '   ', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'crops/x.jpg', '//evil.example/x.jpg', 'ftp://x/y.jpg']) {
      expect(mediaSrc({ media_url: bad as string | null | undefined })).toBeNull()
    }
  })
})
