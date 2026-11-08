import { describe, expect, it, vi } from 'vitest'
import { OFFICER, approveBody, confirmedChoice, editBody, editReason, rejectBody, requestState, sendDecision, DecisionError } from './decision'

const r = { id: 'req_1', asset: 'Drone 2' }
const log = (...details: string[]) => details.map((detail, i) => ({ time: `2026-01-01T10:0${i}:00Z`, actor: OFFICER, action: 'decision', detail }))

describe('bodies', () => {
  it('approve is a plain approval by the officer', () => {
    expect(approveBody(r)).toEqual({ request_id: 'req_1', approved: true, officer: OFFICER })
  })
  it('reject needs a reason, tidied to one line', () => {
    expect(rejectBody(r, '   ')).toBeNull()
    expect(rejectBody(r, '  Already \n searched  ')).toEqual({ request_id: 'req_1', approved: false, reason: 'Already searched', officer: OFFICER })
  })
  it('edit is an approval whose reason describes the change (the contract has no edit fields yet)', () => {
    expect(editReason('Drone 2', 'Ground Team 3')).toBe('Edited: Ground Team 3 instead of Drone 2')
    expect(editReason('Drone 2', 'Ground Team 3', ' wind is high ')).toBe('Edited: Ground Team 3 instead of Drone 2. wind is high')
    expect(editBody(r, 'Ground Team 3')).toEqual({ request_id: 'req_1', approved: true, reason: 'Edited: Ground Team 3 instead of Drone 2', officer: OFFICER })
    expect(editBody(r, 'Drone 2')).toBeNull() // not a change
    expect(editBody(r, '')).toBeNull()
  })
})

describe('what the card shows comes from the stream, never from the click', () => {
  it('a request status from the stream wins', () => {
    expect(requestState({ ...r, status: 'approved' }, [], undefined)).toBe('approved')
    expect(requestState({ ...r, status: 'rejected' }, [], { choice: 'approved', baseline: 0 })).toBe('rejected')
  })
  it('without a click it is pending, and with a click but no log entry yet it is sending', () => {
    expect(requestState({ ...r, status: 'pending' }, [], undefined)).toBe('pending')
    expect(requestState({ ...r, status: 'pending' }, [], { choice: 'approved', baseline: 0 })).toBe('sending')
  })
  it('the backend log entry confirms it when the request itself has not been re-sent', () => {
    expect(requestState({ ...r, status: 'pending' }, log('Drone 2: approved'), { choice: 'approved', baseline: 0 })).toBe('approved')
    expect(requestState({ ...r, status: 'pending' }, log('Drone 2: rejected (already searched)'), { choice: 'rejected', baseline: 0 })).toBe('rejected')
  })
  it('a decision logged BEFORE the click, or for another asset, does not confirm it', () => {
    const l = log('Drone 2: approved')
    expect(requestState({ ...r, status: 'pending' }, l, { choice: 'approved', baseline: 1 })).toBe('sending')
    expect(requestState({ ...r, status: 'pending' }, log('Ground Team 1: approved'), { choice: 'approved', baseline: 0 })).toBe('sending')
  })
  it('confirmedChoice reads the newest matching entry after the baseline', () => {
    expect(confirmedChoice(log('Drone 2: rejected (x)', 'Drone 2: approved'), 'Drone 2', 0)).toBe('approved')
    expect(confirmedChoice([], 'Drone 2', 0)).toBeNull()
  })
})

describe('sendDecision', () => {
  const body = approveBody(r)
  it('POSTs JSON to /decision', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    await sendDecision(body, f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.endsWith('/decision')).toBe(true)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })
  it('explains an unreachable server, a vanished request and a refusal', async () => {
    const down = vi.fn(async () => { throw new TypeError('x') })
    await expect(sendDecision(body, down as unknown as typeof fetch)).rejects.toMatchObject({ status: 0, message: 'Could not reach the server' })
    const gone = vi.fn(async () => new Response('{}', { status: 404 }))
    await expect(sendDecision(body, gone as unknown as typeof fetch)).rejects.toMatchObject({ status: 404 })
    const bad = vi.fn(async () => new Response('{}', { status: 500 }))
    const err = await sendDecision(body, bad as unknown as typeof fetch).catch((e) => e)
    expect(err).toBeInstanceOf(DecisionError)
    expect(err.message).toMatch(/500/)
  })
})
