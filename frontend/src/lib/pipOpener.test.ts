import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startPipOpener } from './pipOpener'
import { useStore } from '@/store'
import type { LogMsg, TaskingMsg } from '@/types'

const req = (id: string, asset: string, status: 'pending' | 'approved' | 'rejected' = 'pending'): TaskingMsg => ({
  type: 'tasking',
  data: { id, case_id: 'case_1', asset, status, target_area: [{ lat: 53.5, lon: -113.5 }, { lat: 53.5, lon: -113.51 }, { lat: 53.51, lon: -113.5 }], route: [], duration_min: 10, expected_gain: 0.3, reasons: [], constraints_ok: {} },
})
const log = (detail: string): LogMsg => ({ type: 'log', data: { actor: 'Officer Lee', action: 'decision', detail, time: '2026-11-08T22:00:00Z' } })
const send = (m: TaskingMsg | LogMsg) => useStore.getState().applyMessage(m)
const open = () => useStore.getState().ui.panels.pip

describe('the drone feed opener', () => {
  let stop: () => void
  beforeEach(() => {
    useStore.getState().resetCaseData()
    stop = startPipOpener()
  })
  afterEach(() => stop())

  it('opens when a drone request that was waiting is approved, naming that request', () => {
    send(req('r1', 'Drone 2'))
    expect(open()).toBe(false)
    send(req('r1', 'Drone 2', 'approved'))
    expect(open()).toBe(true)
    expect(useStore.getState().ui.pipRequestId).toBe('r1')
  })

  it('does not open for a ground team, a rejection, or a request that is still pending', () => {
    send(req('g1', 'Ground Team 1'))
    send(req('g1', 'Ground Team 1', 'approved'))
    send(req('d1', 'Drone 1'))
    send(req('d1', 'Drone 1', 'rejected'))
    send(req('d2', 'Drone 2'))
    expect(open()).toBe(false)
  })

  it('does not open for a request that arrives already approved (a reload or a replay)', () => {
    send(req('r9', 'Drone 2', 'approved'))
    expect(open()).toBe(false)
  })

  it('opens when the stream confirms an approval through the log, and for an edited approval names the new asset', () => {
    send(req('e1', 'Ground Team 2'))
    useStore.getState().beginDecision('e1', 'approved')
    send(log('Ground Team 2: approved (Edited: Drone 1 instead of Ground Team 2)'))
    expect(open()).toBe(true)
  })

  it('opens once per approval, so closing it stays closed', () => {
    send(req('r1', 'Drone 2'))
    send(req('r1', 'Drone 2', 'approved'))
    useStore.getState().closePip()
    send(req('r1', 'Drone 2', 'approved'))
    expect(open()).toBe(false)
    expect(useStore.getState().ui.pipRequestId).toBeNull()
  })

  it('a new case closes the feed', () => {
    send(req('r1', 'Drone 2'))
    send(req('r1', 'Drone 2', 'approved'))
    useStore.getState().resetCaseData()
    expect(open()).toBe(false)
  })
})
