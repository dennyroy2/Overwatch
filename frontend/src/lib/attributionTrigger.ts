// Clicking an evidence card in the timeline shows what THAT card removed, kept and brought in (step 36), for a few
// seconds, in the live picture only. A plain note changes nothing, so it shows nothing.
//
// The overlay is driven by the click itself, not by changes to the selection. Driving it from the selection made it
// look random: after the colours faded the card was still selected, so the next click on it deselected it and showed
// nothing, and only the click after that showed them again. Now every click on a card shows its colours (the same card
// again after they faded too), and nothing else colours the ghosts: a map pin, "Show card" or a new card arriving only
// selects. Selecting something else, deselecting (Esc, empty map), pausing or replaying hides the colours at once.
import { ATTRIBUTION_MS, hideAttribution, showAttribution } from '@/map/attributionLayer'
import type { AttributionSnapshot } from '@/stream/attribution'
import { useStore } from '@/store'

let shownId: string | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function clear(): void {
  if (timer) clearTimeout(timer)
  timer = null
  shownId = null
  hideAttribution()
  if (useStore.getState().ui.attribution) useStore.getState().setAttribution(null)
}

/** True while card `id`'s colours are on the map. */
export function attributionShownFor(id: string): boolean {
  return shownId === id
}

/** Select card `id` and show its colours (live picture, not a plain note). Returns what is shown, or null. */
function show(id: string): AttributionSnapshot | null {
  const s = useStore.getState()
  clear()
  if (s.ui.selectedEvidenceId !== id) s.selectEvidence(id)
  if (s.ui.replay.mode !== 'live') return null
  const ev = s.evidence.byId[id]
  if (!ev || ev.kind === 'note') return null
  const snap = showAttribution(id)
  shownId = id
  s.setAttribution({
    id,
    removed: snap ? snap.removedCount : null,
    stayed: snap ? snap.stayedCount : null,
    arrived: snap ? snap.arrivedCount : null,
  })
  timer = setTimeout(clear, ATTRIBUTION_MS)
  return snap
}

/**
 * The officer clicked evidence card `id` in the timeline. A click on the selected card whose colours are showing (or
 * that can never show any: a note, or the picture is paused) deselects it. Any other click selects the card and shows
 * its colours. Returns whether the card is now selected, and what its colours show, for the camera.
 */
export function clickEvidenceCard(id: string): { selected: boolean; snapshot: AttributionSnapshot | null } {
  const s = useStore.getState()
  if (s.ui.selectedEvidenceId === id) {
    const ev = s.evidence.byId[id]
    const canShow = s.ui.replay.mode === 'live' && !!ev && ev.kind !== 'note'
    if (!canShow || attributionShownFor(id)) {
      s.selectEvidence(null) // the subscription below hides the colours
      return { selected: false, snapshot: null }
    }
  }
  return { selected: true, snapshot: show(id) }
}

/** Hide the colours as soon as their card is no longer the selected one or the picture leaves live. */
export function startAttributionTrigger(): () => void {
  const sync = () => {
    if (!shownId) return
    const s = useStore.getState()
    if (s.ui.selectedEvidenceId !== shownId || s.ui.replay.mode !== 'live') clear()
  }
  const unsub = useStore.subscribe(sync)
  return () => {
    unsub()
    clear()
  }
}
