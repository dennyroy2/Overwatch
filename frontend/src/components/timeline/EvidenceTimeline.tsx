import { useEffect, useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import { focusPoint, visibleAt } from '@/lib/evidence'
import { useNow } from '@/lib/useNow'
import { useWhy } from '@/lib/whySelect'
import { flyToPoint, frameRoute } from '@/map/camera'
import { focusCard } from '@/lib/cardFocus'
import { attribution } from '@/stream/attribution'
import { currentBuffer, ghosts } from '@/stream/ghostBuffer'
import { getMap } from '@/map/mapRef'
import { useStore } from '@/store'
import { history } from '@/stream/history'
import { EvidenceCard } from './EvidenceCard'

/**
 * The case timeline (left rail): newest first. It shows exactly what the store holds, nothing more (hard
 * rule 3), and while the view is paused or replaying it shows only what had arrived by that moment.
 */
export function EvidenceTimeline() {
  const order = useStore((s) => s.evidence.order)
  const byId = useStore((s) => s.evidence.byId)
  const meta = useStore((s) => s.evidenceMeta)
  const mode = useStore((s) => s.ui.replay.mode)
  const replayT = useStore((s) => s.replayView?.t ?? null)
  const selectedId = useStore((s) => s.ui.selectedEvidenceId)
  const hoveredId = useStore((s) => s.ui.hoveredEvidenceId)
  const selectEvidence = useStore((s) => s.selectEvidence)
  const hoverEvidence = useStore((s) => s.hoverEvidence)
  const now = useNow(500)

  const ids = useMemo(() => {
    const replay = { mode, t: replayT }
    return [...order].reverse().filter((id) => visibleAt(replay, history.firstSeen.get(id)))
  }, [order, mode, replayT])

  // "Why?" mode (step 37): the cards behind the selected cluster light up and the rest step back.
  const why = useWhy()
  const whySeq = useStore((s) => s.ui.whySeq)
  const lit = useMemo(() => (why ? new Set(why.items.map((i) => i.id)) : null), [why])
  const litKey = lit ? [...lit].join(',') : ''
  useEffect(() => {
    // When a cluster is picked, bring its first lit card into view (the rail may be longer than the screen).
    if (!lit) return
    const first = ids.find((id) => lit.has(id))
    if (first) document.querySelector(`li[data-evidence-id="${first}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a cluster is picked or its evidence changes
  }, [whySeq, litKey])

  const onSelect = (id: string) => {
    const same = selectedId === id
    selectEvidence(same ? null : id)
    // Clicking a card flies the camera to its mark. If the card changed the swarm over a wide area (a sighting
    // removes a cloud in one place and brings one up in another), frame the whole before-and-after instead, so
    // the red and cyan dots the overlay shows are all on screen (step 36).
    const e = byId[id]
    const p = e ? focusPoint(e) : null
    const map = getMap()
    if (same || !map) return
    focusCard(p, {
      snapshot: () => (mode === 'live' && e && e.kind !== 'note' ? attribution.snapshot(id, ghosts.count, currentBuffer()) : null),
      frameRoute: (frame) => frameRoute(map, frame),
      flyTo: (pt) => flyToPoint(map, pt),
    })
  }

  if (ids.length === 0) {
    return (
      <p className="mt-2 max-w-[32ch] text-base text-ink-3">
        Nothing had arrived yet at this moment. Drag the time bar forward to see evidence appear.
      </p>
    )
  }
  return (
    <ol className="flex flex-col gap-2" aria-label="Evidence, newest first">
      <AnimatePresence initial={false}>
        {ids.map((id) => (
          <EvidenceCard
            key={id}
            evidence={byId[id]}
            seenAt={meta[id]?.seenAt ?? now}
            now={now}
            selected={selectedId === id}
            hovered={hoveredId === id}
            why={lit ? (lit.has(id) ? 'lit' : 'dim') : null}
            onSelect={onSelect}
            onHover={hoverEvidence}
          />
        ))}
      </AnimatePresence>
    </ol>
  )
}
