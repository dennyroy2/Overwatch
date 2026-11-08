import { describe, expect, it } from 'vitest'
import { ARC_GROW_MS, ARC_STAGGER_MS, TYPE_CPS, arcProgress, arcsDoneAt, buildWhy, scrimProgress, typedLength } from './why'
import type { Cluster, Evidence, WithId } from '@/types'

const ev = (id: string, kind: Evidence['kind'], loc: { lat: number; lon: number } | null, extra: Partial<Evidence> = {}): WithId<Evidence> => ({
  id, case_id: 'c', kind, time: '2026-11-08T22:00:00Z', source: 'witness', reliability: 0.7, confirmed: false, summary: `${kind} ${id}`, location: loc, ...extra,
}) as WithId<Evidence>
const cluster = (over: Partial<Cluster> = {}): Cluster => ({ id: 'cl_0', center: { lat: 53.53, lon: -113.52 }, probability: 0.58, story: '58% of the remaining possibilities are about 1.6 km southeast of where she was last seen.', evidence_ids: [], ...over })

describe('buildWhy', () => {
  const byId = { a: ev('a', 'sighting', { lat: 53.5, lon: -113.5 }), b: ev('b', 'clue', { lat: 53.51, lon: -113.51 }), n: ev('n', 'note', null) }
  const order = ['a', 'n', 'b']

  it('lists the evidence the engine attaches, in timeline order, each with its place', () => {
    const w = buildWhy(cluster({ evidence_ids: ['b', 'a'] }), byId, order)!
    expect(w.items.map((i) => i.id)).toEqual(['a', 'b']) // oldest first, whatever order the engine listed them
    expect(w.items[0].place).toEqual({ lat: 53.5, lon: -113.5 })
    expect(w.missing).toBe(0)
  })

  it('an evidence item with no place is listed with no arc, and an item this screen does not have is counted, not invented', () => {
    const w = buildWhy(cluster({ evidence_ids: ['n', 'ghost'] }), byId, order)!
    expect(w.items.map((i) => [i.id, i.place])).toEqual([['n', null]])
    expect(w.missing).toBe(1)
  })

  it('uses an area evidence item\'s first corner when it has no point', () => {
    const area = ev('s', 'searched_area', null, { area: [{ lat: 53.52, lon: -113.53 }, { lat: 53.52, lon: -113.54 }, { lat: 53.53, lon: -113.54 }] })
    expect(buildWhy(cluster({ evidence_ids: ['s'] }), { s: area }, ['s'])!.items[0].place).toEqual({ lat: 53.52, lon: -113.53 })
  })

  it('shows the story as the engine wrote it, and Story pending (null) when it is missing or blank, never made-up text', () => {
    expect(buildWhy(cluster(), byId, order)!.story).toContain('58% of the remaining possibilities')
    expect(buildWhy(cluster({ story: null }), byId, order)!.story).toBeNull()
    expect(buildWhy(cluster({ story: '   ' }), byId, order)!.story).toBeNull()
    expect(buildWhy(cluster({ story: undefined }), byId, order)!.story).toBeNull()
  })

  it('a cluster with no evidence has an empty list, and no cluster means no view; replay hides what had not arrived', () => {
    expect(buildWhy(cluster(), byId, order)!.items).toEqual([])
    expect(buildWhy(null, byId, order)).toBeNull()
    expect(buildWhy(cluster({ evidence_ids: ['a', 'b'] }), byId, order, (id) => id !== 'b')!.items.map((i) => i.id)).toEqual(['a'])
  })
})

describe('typedLength', () => {
  it('types at 60 characters a second, never past the end, never backwards', () => {
    expect(TYPE_CPS).toBe(60)
    expect(typedLength(0, 200)).toBe(0)
    expect(typedLength(500, 200)).toBe(30)
    expect(typedLength(60_000, 200)).toBe(200)
    expect(typedLength(-5, 200)).toBe(0)
    expect(typedLength(100, 0)).toBe(0)
  })
  it('shows everything at once when the speed is 0 (reduced motion)', () => {
    expect(typedLength(0, 120, 0)).toBe(120)
  })
})

describe('arcs', () => {
  it('each arc starts a little after the one before and ends fully drawn', () => {
    expect(arcProgress(0, 0)).toBe(0)
    expect(arcProgress(ARC_GROW_MS, 0)).toBe(1)
    expect(arcProgress(ARC_STAGGER_MS, 1)).toBe(0) // the second has not started yet
    expect(arcProgress(ARC_STAGGER_MS + ARC_GROW_MS, 1)).toBe(1)
    expect(arcProgress(ARC_GROW_MS / 2, 0)).toBeGreaterThan(0.5) // eased out: more than half way in half the time
    expect(arcProgress(1e6, 5)).toBe(1)
  })
  it('knows when everything is done, so it can stop redrawing every frame', () => {
    expect(arcsDoneAt(0)).toBe(0)
    expect(arcsDoneAt(1)).toBe(ARC_GROW_MS)
    expect(arcsDoneAt(3)).toBe(ARC_GROW_MS + 2 * ARC_STAGGER_MS)
  })
  it('the scrim eases in and stops at full', () => {
    expect(scrimProgress(0)).toBe(0)
    expect(scrimProgress(150)).toBe(0.5)
    expect(scrimProgress(10_000)).toBe(1)
  })
})
