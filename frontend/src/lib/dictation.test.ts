import { describe, expect, it } from 'vitest'
import { appendSpoken } from './dictation'

describe('appendSpoken', () => {
  it('adds what was said after the typed text with a single space', () => {
    expect(appendSpoken('', ' bus driver saw her ')).toBe('bus driver saw her')
    expect(appendSpoken('At the bridge,', 'she wore blue')).toBe('At the bridge, she wore blue')
    expect(appendSpoken('typed', '')).toBe('typed')
  })
})

import { normalize, peakOf } from './dictation'
describe('normalize', () => {
  it('lifts a quiet recording to a healthy level, but leaves silence and loud audio alone', () => {
    const quiet = new Float32Array([0.05, -0.1, 0.075])
    expect(peakOf(normalize(quiet))).toBeCloseTo(0.9, 1)
    const veryQuiet = new Float32Array([0.01, -0.02])
    expect(peakOf(normalize(veryQuiet))).toBeCloseTo(0.8, 1) // gain is capped at 40x
    const silent = new Float32Array([0.0005, -0.001])
    expect(peakOf(normalize(silent))).toBeLessThan(0.002)
    const loud = new Float32Array([0.8, -0.9])
    expect(peakOf(normalize(loud))).toBeCloseTo(0.9, 5)
  })
})
