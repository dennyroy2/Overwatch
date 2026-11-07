import { describe, expect, it, vi } from 'vitest'
import { CloseError, closeBody, closedOutcome, foundKey, sendClose } from './close'
import { OFFICER } from './officer'

const entry = (action: string) => ({ time: '2026-01-01T10:00:00Z', actor: OFFICER, action, detail: '' })

describe('closeBody', () => {
  it('says found only when told to, names the officer, and sends an empty note when there is none', () => {
    expect(closeBody(true)).toEqual({ found: true, officer: OFFICER, note: '' })
    expect(closeBody(false, '   ')).toEqual({ found: false, officer: OFFICER, note: '' })
    expect(closeBody(false, '  Called off\nby family ')).toEqual({ found: false, officer: OFFICER, note: 'Called off by family' })
  })
})

describe('closedOutcome', () => {
  it('is derived from the log: open until search_closed, located only with found_confirmed', () => {
    expect(closedOutcome([])).toBeNull()
    expect(closedOutcome([entry('found_confirmed')])).toBeNull() // the close entry has not arrived
    expect(closedOutcome([entry('found_confirmed'), entry('search_closed')])).toBe('located')
    expect(closedOutcome([entry('search_closed')])).toBe('not_located')
  })
})

describe('foundKey', () => {
  it('distinguishes one match from another', () => {
    const a = { case_id: 'c', location: { lat: 1, lon: 2 }, note: 'x' }
    expect(foundKey(null)).toBeNull()
    expect(foundKey(a)).toBe(foundKey({ ...a }))
    expect(foundKey(a)).not.toBe(foundKey({ ...a, location: { lat: 1, lon: 3 } }))
    expect(foundKey(a)).not.toBe(foundKey({ ...a, evidence_id: 'ev_1' }))
  })
})

describe('sendClose', () => {
  const body = closeBody(true)
  it('POSTs the body to /case/{id}/close', async () => {
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
    await sendClose('case_1', body, f as unknown as typeof fetch)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.endsWith('/case/case_1/close')).toBe(true)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })
  it('explains an unreachable server, an unknown case and a refusal', async () => {
    const down = vi.fn(async () => { throw new TypeError('x') })
    await expect(sendClose('c', body, down as unknown as typeof fetch)).rejects.toMatchObject({ status: 0 })
    const gone = vi.fn(async () => new Response('{}', { status: 404 }))
    await expect(sendClose('c', body, gone as unknown as typeof fetch)).rejects.toMatchObject({ status: 404 })
    const bad = vi.fn(async () => new Response('{}', { status: 500 }))
    expect(await sendClose('c', body, bad as unknown as typeof fetch).catch((e) => e)).toBeInstanceOf(CloseError)
  })
})
