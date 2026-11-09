import { describe, expect, it, vi } from 'vitest'
import { focusCard } from './cardFocus'
import type { AttributionSnapshot } from '@/stream/attribution'

const cloud = (lon: number, lat: number, n: number) => {
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { a[i * 3] = lon + (i % 10) * 0.001; a[i * 3 + 1] = lat + Math.floor(i / 10) * 0.001 }
  return a
}
// A sighting: a cloud removed in one place, a cloud arrived about 4 km away.
const wide = (): AttributionSnapshot => ({
  removed: cloud(-113.5, 53.55, 100), removedCount: 100, killedCount: 100, dimmedCount: 0,
  stayed: new Float32Array(0), stayedCount: 0,
  arrived: cloud(-113.55, 53.52, 100), arrivedCount: 100, open: false,
})
const none = (): AttributionSnapshot => ({ ...wide(), removedCount: 0, arrivedCount: 0 })
const mark = { lat: 53.52, lon: -113.55 }

describe('clicking an evidence card moves the camera', () => {
  it('frames the whole before-and-after when the card changed the swarm over a wide area, so the red and cyan ghosts are on screen', () => {
    const frameRoute = vi.fn(), flyTo = vi.fn()
    focusCard(mark, { snapshot: wide, frameRoute, flyTo })
    expect(frameRoute).toHaveBeenCalledTimes(1)
    expect(frameRoute.mock.calls[0][0].length).toBeGreaterThan(1)
    expect(flyTo).not.toHaveBeenCalled()
  })
  it('flies to the card’s own mark when it changed nothing', () => {
    const frameRoute = vi.fn(), flyTo = vi.fn()
    focusCard(mark, { snapshot: none, frameRoute, flyTo })
    expect(flyTo).toHaveBeenCalledWith(mark)
    expect(frameRoute).not.toHaveBeenCalled()
  })
  it('flies to the mark when there is no record of the card (not live, or a plain note)', () => {
    const frameRoute = vi.fn(), flyTo = vi.fn()
    focusCard(mark, { snapshot: () => null, frameRoute, flyTo })
    expect(flyTo).toHaveBeenCalledWith(mark)
  })
  it('does nothing when there is nothing to show and no mark', () => {
    const frameRoute = vi.fn(), flyTo = vi.fn()
    focusCard(null, { snapshot: () => null, frameRoute, flyTo })
    expect(frameRoute).not.toHaveBeenCalled()
    expect(flyTo).not.toHaveBeenCalled()
  })
})
