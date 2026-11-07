import { describe, expect, it } from 'vitest'
import { appendSpoken } from './dictation'

describe('appendSpoken', () => {
  it('adds what was said after the typed text with a single space', () => {
    expect(appendSpoken('', ' bus driver saw her ')).toBe('bus driver saw her')
    expect(appendSpoken('At the bridge,', 'she wore blue')).toBe('At the bridge, she wore blue')
    expect(appendSpoken('typed', '')).toBe('typed')
  })
})
