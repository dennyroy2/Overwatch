import { describe, expect, it } from 'vitest'
import { closedAt, feedVisibleAt, foundVisibleAt, requestStateAt, viewingPast } from './replayState'
import type { LogEntry } from '@/types'

const live = { mode: 'live', t: null }
const at = (t: number) => ({ mode: 'paused', t })
const req = { id: 'r1', asset: 'Drone 2', status: 'approved' as const }
const hist = (over: object = {}) => ({ decisions: new Map<string, { t: number; state: 'approved' | 'rejected' }>(), logAt: new Map<string, number>(), foundAt: undefined as number | undefined, feedOpenedAt: undefined as number | undefined, ...over })
const entry = (action: string): LogEntry => ({ actor: 'Officer Lee', action, detail: '', time: '2026-11-08T22:00:00Z' }) as LogEntry

describe('viewingPast', () => {
  it('is only true for a recorded moment', () => {
    expect(viewingPast(live)).toBe(false)
    expect(viewingPast(null)).toBe(false)
    expect(viewingPast({ mode: 'paused', t: null })).toBe(false)
    expect(viewingPast(at(5))).toBe(true)
  })
})

describe('requestStateAt', () => {
  const h = hist({ decisions: new Map([['r1', { t: 40_000, state: 'approved' as const }]]) })
  it('shows a decision only from the moment the stream confirmed it', () => {
    expect(requestStateAt(req, [], undefined, at(20_000), h)).toBe('pending')
    expect(requestStateAt(req, [], undefined, at(39_999), h)).toBe('pending')
    expect(requestStateAt(req, [], undefined, at(40_000), h)).toBe('approved')
    expect(requestStateAt(req, [], undefined, at(90_000), h)).toBe('approved')
  })
  it('live always shows the real state, and a request that arrived already decided is decided from the start', () => {
    expect(requestStateAt(req, [], undefined, live, h)).toBe('approved')
    expect(requestStateAt(req, [], undefined, at(1), hist())).toBe('approved')
  })
  it('a rejection works the same way, and a request that is still pending stays pending', () => {
    const rej = { id: 'r2', asset: 'Ground Team 1', status: 'rejected' as const }
    expect(requestStateAt(rej, [], undefined, at(5), hist({ decisions: new Map([['r2', { t: 9, state: 'rejected' as const }]]) }))).toBe('pending')
    expect(requestStateAt({ id: 'r3', asset: 'Drone 1', status: 'pending' as const }, [], undefined, at(5), hist())).toBe('pending')
  })
})

describe('the possible match, the closed search and the drone feed', () => {
  it('appear only from the moment they happened', () => {
    const h = hist({ foundAt: 36_000, logAt: new Map([['search_closed', 50_000]]), feedOpenedAt: 16_000 })
    expect(foundVisibleAt(at(20_000), h)).toBe(false)
    expect(foundVisibleAt(at(36_000), h)).toBe(true)
    expect(foundVisibleAt(live, h)).toBe(true)
    expect(foundVisibleAt(at(1), hist())).toBe(true) // never recorded: do not hide it
    const log = [entry('found_confirmed'), entry('search_closed')]
    expect(closedAt(log, at(40_000), h)).toBeNull()
    expect(closedAt(log, at(50_000), h)).toBe('located')
    expect(closedAt(log, live, h)).toBe('located')
    expect(closedAt([], live, h)).toBeNull()
    expect(closedAt([entry('search_closed')], at(60_000), h)).toBe('not_located')
    expect(feedVisibleAt(true, at(10_000), h)).toBe(false)
    expect(feedVisibleAt(true, at(16_000), h)).toBe(true)
    expect(feedVisibleAt(false, at(99_000), h)).toBe(false)
    expect(feedVisibleAt(true, live, h)).toBe(true)
  })
})
