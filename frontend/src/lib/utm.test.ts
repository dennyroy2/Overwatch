import { describe, expect, it } from 'vitest'
import { toUtm, utmString } from './utm'

describe('utm', () => {
  it('matches the CalTopo readout a searcher showed us (12U 0291922E 5699445N)', () => {
    const u = toUtm(-113.99198, 51.408)
    expect(u.zone).toBe(12)
    expect(u.band).toBe('U')
    expect(Math.abs(u.east - 291922)).toBeLessThan(2)
    expect(Math.abs(u.north - 5699445)).toBeLessThan(2)
  })
  it('formats like the backend', () => {
    expect(utmString(-113.5337, 53.5422)).toBe('12U 0332116E 5935574N')
  })
})
