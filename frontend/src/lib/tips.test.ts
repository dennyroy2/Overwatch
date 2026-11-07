import { describe, expect, it, vi } from 'vitest'
import { SUMMARY_MAX, TipError, buildNote, sendTip, summarize } from './tips'

describe('buildNote', () => {
  it('is a plain officer note with the exact words, no place, and the given time', () => {
    const n = buildNote('case_1', '  Bus driver saw a woman in a blue jacket get off at the river valley stop  ', Date.UTC(2026, 0, 1, 12, 0, 0))
    expect(n).toEqual({
      case_id: 'case_1',
      kind: 'note',
      source: 'officer',
      time: '2026-01-01T12:00:00.000Z',
      summary: 'Bus driver saw a woman in a blue jacket get off at the river valley stop',
      raw_text: 'Bus driver saw a woman in a blue jacket get off at the river valley stop',
    })
    expect('location' in n).toBe(false) // the location stays empty: the agent works it out
    expect('id' in n).toBe(false) // the server assigns the id
  })

  it('keeps the words exactly, line breaks included, in raw_text', () => {
    const n = buildNote('c', 'saw her\nnear the bridge', 0)
    expect(n.raw_text).toBe('saw her\nnear the bridge')
    expect(n.summary).toBe('saw her near the bridge')
  })
})

describe('summarize', () => {
  it('collapses whitespace and shortens a long tip to one line', () => {
    expect(summarize('a   b \n c')).toBe('a b c')
    const long = 'x'.repeat(500)
    const s = summarize(long)
    expect(s.length).toBeLessThanOrEqual(SUMMARY_MAX)
    expect(s.endsWith('…')).toBe(true)
    expect(summarize('short')).toBe('short')
  })
})

describe('sendTip', () => {
  const note = buildNote('case_1', 'hello', 0)
  const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))

  it('POSTs JSON to /evidence and returns the saved evidence', async () => {
    const f = ok({ id: 'ev_1', ...note })
    const saved = await sendTip(note, f as unknown as typeof fetch)
    expect(saved.id).toBe('ev_1')
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.endsWith('/evidence')).toBe(true)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(note)
  })

  it('explains a missing server, a closed case and a refusal', async () => {
    const down = vi.fn(async () => { throw new TypeError('network') })
    await expect(sendTip(note, down as unknown as typeof fetch)).rejects.toMatchObject({ status: 0, message: 'Could not reach the server' })
    const gone = vi.fn(async () => new Response('{}', { status: 404 }))
    await expect(sendTip(note, gone as unknown as typeof fetch)).rejects.toMatchObject({ status: 404 })
    const bad = vi.fn(async () => new Response('{}', { status: 422 }))
    const err = await sendTip(note, bad as unknown as typeof fetch).catch((e) => e)
    expect(err).toBeInstanceOf(TipError)
    expect(err.status).toBe(422)
  })
})
