import { beforeEach, describe, expect, it } from 'vitest'
import { useStore, upsertById, selectPendingCount } from './index'
import { offsetPoint } from '@/lib/geo'
import type { Evidence, TaskingRequest } from '@/types'

const ev = (id: string, over: Partial<Evidence> = {}): Evidence => ({
  id, case_id: 'c1', kind: 'note', source: 'officer', time: '2026-01-01T00:00:00Z', summary: 'x', reliability: 0.7, confirmed: false, ...over,
} as Evidence)
const profile = () => ({ name: 'M', age: 79, condition: 'dementia' as const, mobility: 'low' as const, notes: '' })
const req = (id: string, status: TaskingRequest['status'] = 'pending'): TaskingRequest => ({
  id, case_id: 'c1', asset: 'Drone 2', target_area: [], route: [], expected_gain: 0.2, duration_min: 12, reasons: [], status,
})

describe('upsert by id', () => {
  beforeEach(() => useStore.getState().resetCaseData())

  it('replaces in place and keeps the original position (a note card fills in)', () => {
    const { applyMessage } = useStore.getState()
    applyMessage({ type: 'evidence', data: ev('a', { summary: 'raw note' }) })
    applyMessage({ type: 'evidence', data: ev('b') })
    applyMessage({ type: 'evidence', data: ev('a', { kind: 'sighting', summary: 'parsed' }) })
    const { evidence } = useStore.getState()
    expect(evidence.order).toEqual(['a', 'b'])
    expect(evidence.byId.a.kind).toBe('sighting')
    expect(evidence.byId.a.summary).toBe('parsed')
  })

  it('hydrate then live message for the same id yields one card (no duplicates)', () => {
    const { hydrate, applyMessage } = useStore.getState()
    const report = { case: profile(), evidence: [ev('a'), ev('a', { summary: 'dup' })], requests: [req('r1')], log: [] }
    hydrate(report)
    applyMessage({ type: 'evidence', data: ev('a', { summary: 'live' }) })
    expect(useStore.getState().evidence.order).toEqual(['a'])
    expect(useStore.getState().evidence.byId.a.summary).toBe('live')
  })

  it('dedupes identical log entries from hydrate and the stream', () => {
    const entry = { time: '2026-01-01T00:00:00Z', actor: 'system', action: 'evidence_added', detail: 'x' }
    const { hydrate, applyMessage } = useStore.getState()
    hydrate({ case: profile(), evidence: [], requests: [], log: [entry] })
    applyMessage({ type: 'log', data: entry })
    expect(useStore.getState().log).toHaveLength(1)
  })

  it('counts only pending requests', () => {
    const { applyMessage } = useStore.getState()
    applyMessage({ type: 'tasking', data: req('r1') })
    applyMessage({ type: 'tasking', data: req('r2', 'approved') })
    expect(selectPendingCount(useStore.getState())).toBe(1)
  })

  it('ignores messages with no id instead of crashing', () => {
    useStore.getState().applyMessage({ type: 'evidence', data: { ...ev('x'), id: undefined } })
    expect(useStore.getState().evidence.order).toEqual([])
  })

  it('upsertById does not mutate its input', () => {
    const a = { byId: {}, order: [] as string[] }
    upsertById(a, { id: 'z' })
    expect(a.order).toEqual([])
  })
})

describe('cluster selection in the store', () => {
  const ORIGIN = { lat: 53.5422, lon: -113.5337 }
  const mk = (id: string, east: number, p: number) => ({ id, center: offsetPoint(ORIGIN, east, 0), probability: p, evidence_ids: [] })

  beforeEach(() => useStore.getState().resetCaseData())

  it('select remembers the place, and the selection follows that place when ranks swap', () => {
    const s = useStore.getState()
    s.applyGhostMeta('t', 1, [mk('cl_0', 0, 0.4), mk('cl_1', 3000, 0.3)])
    s.selectCluster(useStore.getState().clusters[0])
    expect(useStore.getState().ui.selectedClusterId).toBe('cl_0')
    // the clusters swap ranks: the selected place is now called cl_1
    useStore.getState().applyGhostMeta('t', 1, [mk('cl_0', 3000, 0.45), mk('cl_1', 8, 0.35)])
    expect(useStore.getState().ui.selectedClusterId).toBe('cl_1')
  })

  it('the selection clears when its place no longer has a cluster, and with selectCluster(null)', () => {
    const s = useStore.getState()
    s.applyGhostMeta('t', 1, [mk('cl_0', 0, 0.4)])
    s.selectCluster(useStore.getState().clusters[0])
    useStore.getState().applyGhostMeta('t', 1, [mk('cl_0', 9000, 0.4)])
    expect(useStore.getState().ui.selectedClusterId).toBeNull()
    expect(useStore.getState().ui.selectedPlace).toBeNull()
    s.applyGhostMeta('t', 1, [mk('cl_0', 0, 0.4)])
    s.selectCluster(useStore.getState().clusters[0])
    useStore.getState().selectCluster(null)
    expect(useStore.getState().ui.selectedClusterId).toBeNull()
  })

  it('no selection means ghost frames leave ui untouched', () => {
    const before = useStore.getState().ui
    useStore.getState().applyGhostMeta('t', 1, [mk('cl_0', 0, 0.4)])
    expect(useStore.getState().ui).toBe(before)
  })
})
