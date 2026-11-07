import { useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import { focusPoint, visibleAt } from '@/lib/evidence'
import { useNow } from '@/lib/useNow'
import { flyToPoint } from '@/map/camera'
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

  const onSelect = (id: string) => {
    const same = selectedId === id
    selectEvidence(same ? null : id)
    // Clicking a card flies the camera to its mark.
    const e = byId[id]
    const p = e ? focusPoint(e) : null
    const map = getMap()
    if (!same && p && map) flyToPoint(map, p)
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
            onSelect={onSelect}
            onHover={hoverEvidence}
          />
        ))}
      </AnimatePresence>
    </ol>
  )
}
