import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attributionShownFor, clickEvidenceCard, startAttributionTrigger } from './attributionTrigger'
import { ATTRIBUTION_MS, attributionOpacity, hideAttribution, showAttribution, swarmDimFactor } from '@/map/attributionLayer'
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

describe('swarmDimFactor', () => {
  it('leaves the amber swarm alone with no overlay, and steps it back while one shows, following its fade', () => {
    attribution.reset()
    hideAttribution()
    expect(swarmDimFactor(1000)).toBe(1)
    attribution.noteEvidence('s1', 'sighting', 0, new Float32Array(0))
    showAttribution('s1', 1000)
    expect(swarmDimFactor(1000)).toBe(1) // fade starts at full brightness
    expect(swarmDimFactor(3000)).toBeCloseTo(0.2)
    expect(swarmDimFactor(1000 + ATTRIBUTION_MS)).toBe(1)
    hideAttribution()
    expect(swarmDimFactor(3000)).toBe(1)
    attribution.reset()
  })
})

describe('clicking a card shows what it killed and kept', () => {
  let stop: () => void
  beforeEach(() => {
    vi.useFakeTimers()
    useStore.getState().resetCaseData()
    useStore.getState().setReplayMode('live')
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
  const selected = () => useStore.getState().ui.selectedEvidenceId

  it("selects the card, sets the legend to its counts, and clears it when the card is deselected", () => {
    arrive('s1', 'sighting')
    attribution.onKills(kills(0, 1))
    const r = clickEvidenceCard('s1')
    expect(r.selected).toBe(true)
    expect(r.snapshot?.removedCount).toBe(2)
    expect(selected()).toBe('s1')
    expect(legend()).toEqual({ id: 's1', removed: 2, stayed: 3, arrived: 2 })
    useStore.getState().selectEvidence(null) // Esc or a click on empty map
    expect(legend()).toBeNull()
    expect(attributionShownFor('s1')).toBe(false)
  })

  it('every click shows the colours: after they fade, clicking the same card shows them again (no extra click)', () => {
    arrive('s1', 'clue')
    for (let i = 0; i < 4; i++) {
      clickEvidenceCard('s1')
      expect(legend()).not.toBeNull()
      expect(selected()).toBe('s1')
      vi.advanceTimersByTime(ATTRIBUTION_MS + 10)
      expect(legend()).toBeNull()
      expect(selected()).toBe('s1') // still selected, colours faded
    }
  })

  it('a click on the card whose colours are showing turns them off and deselects it', () => {
    arrive('s1', 'clue')
    clickEvidenceCard('s1')
    const r = clickEvidenceCard('s1')
    expect(r.selected).toBe(false)
    expect(selected()).toBeNull()
    expect(legend()).toBeNull()
  })

  it("shows only the clicked card's colours: clicking another card replaces them, and its old timer cannot clear the new one", () => {
    arrive('a', 'sighting')
    attribution.onKills(kills(0))
    arrive('b', 'searched_area')
    attribution.onKills(kills(1, 2, 3))
    clickEvidenceCard('a')
    expect(legend()).toEqual({ id: 'a', removed: 1, stayed: 4, arrived: 1 })
    vi.advanceTimersByTime(ATTRIBUTION_MS - 100)
    clickEvidenceCard('b')
    expect(legend()).toEqual({ id: 'b', removed: 3, stayed: 2, arrived: 3 })
    expect(attributionShownFor('a')).toBe(false)
    vi.advanceTimersByTime(200) // a's timer would have fired here
    expect(legend()?.id).toBe('b')
  })

  it('selecting without a card click (a map pin, "Show card") colours nothing, and hides colours that were showing', () => {
    arrive('a', 'sighting')
    arrive('b', 'clue')
    useStore.getState().selectEvidence('a')
    expect(legend()).toBeNull()
    clickEvidenceCard('b')
    expect(legend()?.id).toBe('b')
    useStore.getState().selectEvidence('a')
    expect(legend()).toBeNull()
  })

  it('a card that removed nothing says 0; a card with no record says so; a plain note shows nothing', () => {
    arrive('quiet', 'favourite_place')
    clickEvidenceCard('quiet')
    expect(legend()).toEqual({ id: 'quiet', removed: 0, stayed: 5, arrived: 0 })
    useStore.getState().applyMessage(ev('old', 'sighting')) // arrived before this view opened: no window
    clickEvidenceCard('old')
    expect(legend()).toEqual({ id: 'old', removed: null, stayed: null, arrived: null })
    arrive('tip', 'note')
    clickEvidenceCard('tip')
    expect(selected()).toBe('tip')
    expect(legend()).toBeNull()
    expect(clickEvidenceCard('tip').selected).toBe(false) // nothing to show, so a second click deselects
  })

  it('shows nothing while the picture is paused or replayed, and pausing hides colours that were showing', () => {
    arrive('s1', 'sighting')
    clickEvidenceCard('s1')
    expect(legend()).not.toBeNull()
    useStore.getState().setReplayMode('paused')
    expect(legend()).toBeNull()
    clickEvidenceCard('s1')
    expect(legend()).toBeNull()
  })
})
