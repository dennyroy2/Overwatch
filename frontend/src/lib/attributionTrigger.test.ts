import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startAttributionTrigger } from './attributionTrigger'
import { ATTRIBUTION_MS, attributionOpacity } from '@/map/attributionLayer'
import { attribution } from '@/stream/attribution'
import { FLOATS_PER_GHOST, ghosts } from '@/stream/ghostBuffer'
import { useStore } from '@/store'
import type { EvidenceMsg } from '@/types'

const ev = (id: string, kind: EvidenceMsg['data']['kind']): EvidenceMsg => ({
  type: 'evidence',
  data: { id, case_id: 'c1', kind, time: '2026-11-08T22:00:00Z', source: 'witness', reliability: 0.7, confirmed: false, summary: kind },
})
const buffer = new Float32Array(5 * FLOATS_PER_GHOST)
const kills = (...slots: number[]) => ({ count: slots.length, slots: Int32Array.from(slots), pos: new Float32Array(slots.length * 3) })

describe('attributionOpacity', () => {
  it('fades in quickly, holds, fades out slowly, and is off outside its window', () => {
    expect(attributionOpacity(-1)).toBe(0)
    expect(attributionOpacity(0)).toBe(0)
    expect(attributionOpacity(75)).toBeCloseTo(0.5)
    expect(attributionOpacity(2000)).toBe(1)
    expect(attributionOpacity(ATTRIBUTION_MS - 350)).toBeCloseTo(0.5)
    expect(attributionOpacity(ATTRIBUTION_MS)).toBe(0)
  })
})

describe('selecting a card shows what it killed and kept', () => {
  let stop: () => void
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.getState().resetCaseData()
    attribution.reset()
    ghosts.count = 5 // the swarm on screen: five ghosts
    stop = startAttributionTrigger()
  })
  afterEach(() => {
    stop()
    ghosts.count = 0
    vi.useRealTimers()
  })
  const arrive = (id: string, kind: EvidenceMsg['data']['kind']) => {
    attribution.noteEvidence(id, kind, 5, buffer)
    useStore.getState().applyMessage(ev(id, kind))
  }
  const legend = () => useStore.getState().ui.attribution

  it("sets the legend to the card's counts, and clears it when the card is deselected", () => {
    arrive('s1', 'sighting')
    attribution.onKills(kills(0, 1))
    useStore.getState().selectEvidence('s1')
    expect(legend()).toEqual({ id: 's1', removed: 2, stayed: 3, arrived: 2 })
    useStore.getState().selectEvidence(null)
    expect(legend()).toBeNull()
  })

  it('goes away by itself after the display time, and shows again when the card is selected again', () => {
    arrive('s1', 'clue')
    useStore.getState().selectEvidence('s1')
    expect(legend()).not.toBeNull()
    vi.advanceTimersByTime(ATTRIBUTION_MS + 10)
    expect(legend()).toBeNull()
    useStore.getState().selectEvidence(null)
    useStore.getState().selectEvidence('s1')
    expect(legend()).not.toBeNull()
  })

  it('a card that removed nothing says 0; a card with no record says so; a plain note shows nothing', () => {
    arrive('quiet', 'favourite_place')
    useStore.getState().selectEvidence('quiet')
    expect(legend()).toEqual({ id: 'quiet', removed: 0, stayed: 5, arrived: 0 })
    useStore.getState().applyMessage(ev('old', 'sighting')) // arrived before this view opened: no window
    useStore.getState().selectEvidence('old')
    expect(legend()).toEqual({ id: 'old', removed: null, stayed: null, arrived: null })
    arrive('tip', 'note')
    useStore.getState().selectEvidence('tip')
    expect(legend()).toBeNull()
  })

  it('shows nothing while the picture is paused or replayed', () => {
    arrive('s1', 'sighting')
    useStore.getState().setReplayMode('paused')
    useStore.getState().selectEvidence('s1')
    expect(legend()).toBeNull()
  })
})
