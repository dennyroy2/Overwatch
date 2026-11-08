import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  boxLabel, boxToRect, containRect, detectionsAt, frameAt, isDroneAsset, loadManifest, loadSidecar, matchEvidence,
  parseManifest, parseSidecar, pickClip, resetFootageCache, type ClipEntry, type FootageDetection, type Sidecar,
} from './footage'
import { distanceMetres } from '@/lib/geo'

const here = (p: string) => JSON.parse(readFileSync(new URL(`../../public/footage/${p}`, import.meta.url), 'utf8'))

const clip = (id: string, lat: number, lon: number): ClipEntry => ({
  id, video: `/footage/${id}.mp4`, sidecar: `/footage/${id}.detections.json`, asset: 'Drone 2', width: 1280, height: 720,
  duration_s: 14.5, placement: { lat, lon },
})

const det = (over: Partial<FootageDetection>): FootageDetection => ({
  frame: 0, time_s: 0, box: [0.1, 0.1, 0.2, 0.2], label: 'person', confidence: 0.5, matched: false, clue: null, clue_score: 0,
  reliability: null, location: null, radius_m: null, kind: null, evidence_id: null, ...over,
})

const doc = (detections: FootageDetection[], frames = [0, 0.5, 1.0, 1.5]): Sidecar => ({
  clip: 'c', asset: 'Drone 2', width: 1280, height: 720, duration_s: 14.5, fps_sampled: 2, detections,
  frames: frames.map((t, i) => ({ index: i, time_s: t, drone: { lat: 53.5, lon: -113.5, alt_m: 40 + i, heading_deg: 51 } })),
})

describe('the real committed files', () => {
  it('parse, and the clue the stream will deliver is in the sidecar with the same id', () => {
    const clips = parseManifest(here('manifest.json'))
    expect(clips.map((c) => c.id)).toEqual(['margaret_drone2'])
    const sc = parseSidecar(here('margaret_drone2.detections.json'))!
    expect(sc.frames).toHaveLength(29)
    const flagged = sc.detections.find((d) => d.evidence_id === 'ev_margaret_drone2_8_0')!
    expect(flagged.kind).toBe('clue')
    expect(flagged.time_s).toBe(4)
    expect(boxLabel(flagged)).toBe('grey hooded jacket · 90%')
    expect(matchEvidence(sc, { id: 'ev_margaret_drone2_8_0' })).toBe(flagged)
  })
})

describe('parseManifest', () => {
  it('keeps valid clips and ignores everything else', () => {
    const ok = { id: 'a', video: '/footage/a.mp4', sidecar: '/footage/a.detections.json', asset: 'Drone 2', width: 1280, height: 720, duration_s: 14.5, placement: { lat: 1, lon: 2 } }
    expect(parseManifest({ schema: 1, clips: [ok, { id: 'broken' }, { ...ok, placement: { lat: 'x' } }] })).toHaveLength(1)
    for (const bad of [null, undefined, 'x', {}, { clips: 'no' }, '<!doctype html>']) expect(parseManifest(bad)).toEqual([])
  })
})

describe('parseSidecar', () => {
  it('needs schema 1 and drops malformed detections without guessing', () => {
    expect(parseSidecar({ schema: 2 })).toBeNull()
    expect(parseSidecar(null)).toBeNull()
    const good = { schema: 1, clip: 'c', width: 1280, height: 720, duration_s: 14.5, fps_sampled: 2, frames: [{ index: 0, time_s: 0, drone: { lat: 53.5, lon: -113.5, alt_m: 40, heading_deg: 51 } }], detections: [
      { frame: 0, time_s: 0, box: [0, 0, 0.1, 0.1], confidence: 0.5, label: 'person' },
      { frame: 0, time_s: 0, box: [0, 0, 0.1], confidence: 0.5 },
      { frame: 'x', time_s: 0, box: [0, 0, 1, 1], confidence: 0.5 },
    ] }
    const out = parseSidecar(good)!
    expect(out.detections).toHaveLength(1)
    expect(out.detections[0]).toMatchObject({ matched: false, kind: null, evidence_id: null, reliability: null, location: null })
    expect(out.frames[0].drone.alt_m).toBe(40)
  })
})

describe('pickClip', () => {
  const a = clip('a', 53.5336, -113.5378), b = clip('b', 53.6, -113.3)
  it('takes the clip shot nearest the place, or the first when there is no place, or none', () => {
    expect(pickClip([a, b], { lat: 53.59, lon: -113.31 })?.id).toBe('b')
    expect(pickClip([a, b], { lat: 53.534, lon: -113.537 })?.id).toBe('a')
    expect(pickClip([a, b], null)?.id).toBe('a')
    expect(pickClip([], { lat: 1, lon: 1 })).toBeNull()
  })
})

describe('what is drawn at a video time', () => {
  const d0 = det({ frame: 0 }), d1 = det({ frame: 1, time_s: 0.5 }), d1b = det({ frame: 1, time_s: 0.5, box: [0.5, 0.5, 0.6, 0.6] })
  const s = doc([d0, d1, d1b])
  it('is the nearest sampled frame, and nothing once the video is between or past the samples', () => {
    expect(frameAt(s, 0.1)?.index).toBe(0)
    expect(frameAt(s, 0.3)?.index).toBe(1)
    expect(detectionsAt(s, 0.45)).toEqual([d1, d1b])
    expect(detectionsAt(s, 0)).toEqual([d0])
    expect(frameAt(s, 9)).toBeNull()
    expect(detectionsAt(s, 9)).toEqual([])
  })
  it("reports the drone's altitude at that moment", () => {
    expect(frameAt(s, 1.0)?.drone.alt_m).toBe(42)
  })
})

describe('matchEvidence', () => {
  const near = det({ frame: 8, kind: 'clue', evidence_id: 'ev_x_8_0', matched: true, clue: 'grey hooded jacket', clue_score: 1, location: { lat: 53.5338, lon: -113.538 } })
  const far = det({ frame: 30, kind: 'sighting', evidence_id: 'ev_x_30_0', location: { lat: 53.6, lon: -113.4 } })
  const matchedOnly = det({ frame: 9, matched: true, clue: 'jacket', clue_score: 0.7 })
  it('prefers the same id', () => {
    expect(matchEvidence({ detections: [far, near] }, { id: 'ev_x_30_0' })).toBe(far)
  })
  it('falls back to the evidence detection nearest the place when the id is not in the clip', () => {
    expect(matchEvidence({ detections: [far, near] }, { id: 'ev_by_hand', location: { lat: 53.534, lon: -113.537 } })).toBe(near)
    expect(distanceMetres(near.location!, { lat: 53.534, lon: -113.537 })).toBeLessThan(200)
  })
  it('then to the best clothing match, then to nothing', () => {
    expect(matchEvidence({ detections: [matchedOnly, det({})] }, { id: 'z' })).toBe(matchedOnly)
    expect(matchEvidence({ detections: [det({})] }, { id: 'z' })).toBeNull()
    expect(matchEvidence({ detections: [] }, { id: 'z', location: { lat: 1, lon: 1 } })).toBeNull()
  })
})

describe('labels and drone assets', () => {
  it('labels only clothing matches, with the calibrated reliability when there is one', () => {
    expect(boxLabel({ matched: true, clue: 'grey hooded jacket', reliability: 0.9, clue_score: 1 })).toBe('grey hooded jacket · 90%')
    expect(boxLabel({ matched: true, clue: 'dark sneakers', reliability: null, clue_score: 0.62 })).toBe('dark sneakers · 62%')
    expect(boxLabel({ matched: false, clue: null, reliability: null, clue_score: 0 })).toBeNull()
  })
  it('knows a drone from a ground team', () => {
    expect(['Drone 2', 'drone 1', ' Drone 3'].every(isDroneAsset)).toBe(true)
    expect(['Ground Team 1', 'Dronelike', ''].some(isDroneAsset)).toBe(false)
  })
})

describe('picture geometry', () => {
  it('fits a 16:9 video in a taller or wider box with bars, and maps boxes into it', () => {
    expect(containRect(384, 216, 1280, 720)).toEqual({ x: 0, y: 0, w: 384, h: 216 })
    const tall = containRect(400, 400, 1280, 720)
    expect(tall.w).toBe(400)
    expect(tall.h).toBeCloseTo(225)
    expect(tall.y).toBeCloseTo(87.5)
    expect(boxToRect({ x: 10, y: 20, w: 200, h: 100 }, [0.5, 0.5, 0.75, 1])).toEqual({ x: 110, y: 70, w: 50, h: 50 })
    expect(containRect(0, 0, 1280, 720)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('loading', () => {
  beforeEach(() => resetFootageCache())
  it('returns a missing file as an empty result, never an exception, and asks once', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    expect(await loadManifest(f as unknown as typeof fetch)).toEqual([])
    expect(await loadManifest(f as unknown as typeof fetch)).toEqual([])
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('treats a web page served in place of the file as missing', async () => {
    const html = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError('Unexpected token <') } })
    expect(await loadManifest(html as unknown as typeof fetch)).toEqual([])
    expect(await loadSidecar(clip('a', 1, 1), html as unknown as typeof fetch)).toBeNull()
  })
  it('loads and parses a real manifest and sidecar', async () => {
    const f = vi.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes('manifest') ? here('manifest.json') : here('margaret_drone2.detections.json')) }))
    const [c] = await loadManifest(f as unknown as typeof fetch)
    expect(c.video).toBe('/footage/margaret_drone2.mp4')
    expect((await loadSidecar(c, f as unknown as typeof fetch))?.detections.length).toBeGreaterThan(0)
  })
})
