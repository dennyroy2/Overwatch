import { describe, expect, it } from 'vitest'
import { formatDuration, isTypingTarget } from './ui'

describe('formatDuration', () => {
  it('formats ms as m:ss and never goes negative', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(9_400)).toBe('0:09')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_725_000)).toBe('62:05')
    expect(formatDuration(-4_000)).toBe('0:00')
  })
})

describe('isTypingTarget', () => {
  const el = (tagName: string, extra: object = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget
  it('is true for text fields and editable content only', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true)
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true)
    expect(isTypingTarget(el('SELECT'))).toBe(true)
    expect(isTypingTarget(el('DIV', { isContentEditable: true }))).toBe(true)
    expect(isTypingTarget(el('BUTTON'))).toBe(false)
    expect(isTypingTarget(el('DIV'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})
