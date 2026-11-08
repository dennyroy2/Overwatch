import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeCase, openCase } from './client'
import { useStore } from '@/store'
import type { SubjectProfile } from '@/types'

class FakeSocket {
  static all: FakeSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) { this.url = url; FakeSocket.all.push(this) }
  close() {}
}

const profile: SubjectProfile = { name: 'M', age: 79, condition: 'dementia', mobility: 'low', clothing: [], notes: '' }

describe('stream client recovery', () => {
  let posts = 0
  beforeEach(() => {
    posts = 0
    FakeSocket.all = []
    useStore.setState({ toasts: [] })
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') { posts += 1; return { ok: true, json: async () => ({ ...profile, case_id: 'case_1' }) } }
      return { ok: true, json: async () => ({ case: { ...profile, case_id: 'case_1' }, evidence: [], requests: [], log: [] }) }
    }))
  })
  afterEach(() => {
    closeCase()
    vi.unstubAllGlobals()
  })

  it('reopens the case and says so when the server forgot it (the API restarted)', async () => {
    openCase(profile)
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))
    FakeSocket.all[0].onopen?.()                       // it had been live
    expect(posts).toBe(1)
    FakeSocket.all[0].onclose?.({ code: 4404 })        // the server no longer knows the case
    await vi.waitFor(() => expect(posts).toBe(2))      // we created it again
    expect(useStore.getState().toasts.map((t) => t.text)).toContain('The server restarted, so the case was reopened from the start.')
  })

  it('does not call it a restart when the case was never reachable', async () => {
    openCase(profile)
    await vi.waitFor(() => expect(FakeSocket.all).toHaveLength(1))
    FakeSocket.all[0].onclose?.({ code: 4404 })        // never connected: not a restart
    expect(useStore.getState().toasts.map((t) => t.text).join()).not.toMatch(/restarted/)
  })
})
