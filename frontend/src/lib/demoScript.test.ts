import { describe, expect, it, vi } from 'vitest'
import { DEMO_TIPS, QUIET_AFTER_MS, buildDemoEvidence, postEvidence, startDemoTips, type DemoDeps } from './demoScript'

/** A fake clock: timers run when `advance` passes their time. */
function clock() {
  let now = 0
  const timers: { at: number; fn: () => void; id: number; live: boolean }[] = []
  let seq = 0
  return {
    setTimer: (fn: () => void, ms: number) => { const t = { at: now + ms, fn, id: ++seq, live: true }; timers.push(t); return t },
    clearTimer: (h: unknown) => { (h as { live: boolean }).live = false },
    advance(ms: number) {
      const to = now + ms
      for (;;) {
        const next = timers.filter((t) => t.live && t.at <= to).sort((a, b) => a.at - b.at)[0]
        if (!next) break
        now = next.at; next.live = false; next.fn()
      }
      now = to
    },
  }
}

function setup(over: Partial<DemoDeps> = {}) {
  const c = clock()
  const posted: Partial<import('@/types').Evidence>[] = []
  const deps: DemoDeps = {
    caseId: () => 'case_1', evidenceCount: () => 0, lastSeenMs: () => Date.UTC(2026, 10, 8, 21, 0, 0),
    post: async (ev) => { posted.push(ev) }, setTimer: c.setTimer, clearTimer: c.clearTimer, ...over,
  }
  return { c, deps, posted }
}

describe('demo tips', () => {
  it('tells the scenario story with a located, structured tip each time', () => {
    expect(DEMO_TIPS.map((t) => t.kind)).toEqual(['last_seen', 'favourite_place', 'searched_area', 'sighting', 'clue'])
    expect(DEMO_TIPS.every((t) => t.location && t.summary && t.reliability > 0)).toBe(true)
    expect(DEMO_TIPS.at(-1)?.source).toBe('drone_ai')
    expect(DEMO_TIPS.every((t) => !/blue/.test(t.summary))).toBe(true) // the demo subject wears grey
  })

  it('builds evidence whose time is when she was last seen plus the tip\'s minutes', () => {
    const ev = buildDemoEvidence('case_9', DEMO_TIPS[3], Date.UTC(2026, 10, 8, 21, 0, 0))
    expect(ev.case_id).toBe('case_9')
    expect(ev.time).toBe('2026-11-08T21:35:00.000Z')
    expect(ev.confirmed).toBe(true)
    expect('afterS' in ev || 'minutesAfter' in ev).toBe(false)
  })

  it('does nothing when the server sends its own tips', () => {
    const { c, deps, posted } = setup({ evidenceCount: () => 1 })
    startDemoTips(deps)
    c.advance(QUIET_AFTER_MS + 120_000)
    expect(posted).toEqual([])
  })

  it('posts the five tips on their schedule when the server stays quiet', () => {
    const { c, deps, posted } = setup()
    startDemoTips(deps)
    c.advance(QUIET_AFTER_MS - 1)
    expect(posted).toHaveLength(0)
    c.advance(1)
    expect(posted).toHaveLength(0) // the first beat is due 2 s after the takeover (scenario at_s 2)
    c.advance(2000)
    expect(posted.map((p) => p.kind)).toEqual(['last_seen'])
    c.advance(6000) // 8 s: the favourite place
    expect(posted).toHaveLength(2)
    c.advance(60_000)
    expect(posted.map((p) => p.kind)).toEqual(['last_seen', 'favourite_place', 'searched_area', 'sighting', 'clue'])
  })

  it("plays the scenario's own times (Akshat's ask #8): 2, 8, 34, 40 and 48 s", () => {
    expect(DEMO_TIPS.map((x) => x.afterS)).toEqual([2, 8, 34, 40, 48])
    expect(DEMO_TIPS.map((x) => x.minutesAfter)).toEqual([0, 0, 85, 35, 120])
  })

  it('skips its drone clue when one is already on screen (perception delivered it), and posts it when not', () => {
    const withClue = setup({ hasDroneEvidence: () => true })
    startDemoTips(withClue.deps)
    withClue.c.advance(QUIET_AFTER_MS + 120_000)
    expect(withClue.posted.map((p) => p.kind)).toEqual(['last_seen', 'favourite_place', 'searched_area', 'sighting']) // no clue
    const without = setup({ hasDroneEvidence: () => false })
    startDemoTips(without.deps)
    without.c.advance(QUIET_AFTER_MS + 120_000)
    expect(without.posted.map((p) => p.kind)).toEqual(['last_seen', 'favourite_place', 'searched_area', 'sighting', 'clue'])
  })

  it('checks for a drone clue at the moment the beat is due, not when the demo opens', () => {
    let present = false
    const { c, deps, posted } = setup({ hasDroneEvidence: () => present })
    startDemoTips(deps)
    c.advance(QUIET_AFTER_MS + 41_000) // four beats posted, the clue (48 s) not yet due
    present = true // perception's clue arrives in the meantime
    c.advance(30_000)
    expect(posted.map((p) => p.kind)).not.toContain('clue')
  })

  it('stops when cancelled or when another case is open', () => {
    const a = setup()
    const cancel = startDemoTips(a.deps)
    c0(a); cancel(); a.c.advance(120_000)
    expect(a.posted).toHaveLength(1)

    let id = 'case_1'
    const b = setup({ caseId: () => id })
    startDemoTips(b.deps)
    b.c.advance(QUIET_AFTER_MS + 2000)
    id = 'case_2'
    b.c.advance(120_000)
    expect(b.posted).toHaveLength(1)
  })

  it('reports a failed post instead of failing silently', async () => {
    const onError = vi.fn()
    const { c, deps } = setup({ post: () => Promise.reject(new Error('down')), onError })
    startDemoTips(deps)
    c.advance(QUIET_AFTER_MS + 2000)
    await Promise.resolve(); await Promise.resolve()
    expect(onError).toHaveBeenCalledWith('Could not send a demo tip. Is the API running?')
  })

  it('reads the case id when the wait ends, because the server only assigns it after the case opens', () => {
    let id: string | null = null          // not known yet when the demo opens
    const { c, deps, posted } = setup({ caseId: () => id })
    startDemoTips(deps)
    c.advance(1000)
    id = 'case_7'                         // the server answered
    c.advance(QUIET_AFTER_MS)
    c.advance(60_000)
    expect(posted).toHaveLength(5)
    expect(posted.every((p) => p.case_id === 'case_7')).toBe(true)
  })

  it('does not start without an open case', () => {
    const { c, deps, posted } = setup({ caseId: () => null })
    startDemoTips(deps)
    c.advance(120_000)
    expect(posted).toEqual([])
  })
})

function c0(s: ReturnType<typeof setup>) { s.c.advance(QUIET_AFTER_MS + 2000) }

describe('postEvidence', () => {
  it('POSTs JSON to /evidence and throws on a refusal', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true })
    await postEvidence({ case_id: 'c' }, ok as unknown as typeof fetch)
    expect(ok.mock.calls[0][0]).toMatch(/\/evidence$/)
    expect(JSON.parse(ok.mock.calls[0][1].body)).toEqual({ case_id: 'c' })
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    await expect(postEvidence({}, bad as unknown as typeof fetch)).rejects.toThrow('404')
  })
})
