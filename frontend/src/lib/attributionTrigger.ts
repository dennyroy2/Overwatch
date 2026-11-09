// Selecting an evidence card (in the timeline or on the map) shows what it removed, kept and brought in (step 36), for a few
// seconds, in the live picture only. A plain note changes nothing, so it shows nothing.
import { ATTRIBUTION_MS, hideAttribution, showAttribution } from '@/map/attributionLayer'
import { useStore } from '@/store'

export function startAttributionTrigger(): () => void {
  let last: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
    hideAttribution()
    if (useStore.getState().ui.attribution) useStore.getState().setAttribution(null)
  }

  const sync = () => {
    const s = useStore.getState()
    const id = s.ui.selectedEvidenceId
    if (id === last) return
    last = id
    clear()
    if (!id || s.ui.replay.mode !== 'live') return
    const ev = s.evidence.byId[id]
    if (!ev || ev.kind === 'note') return
    const snap = showAttribution(id)
    s.setAttribution({
      id,
      removed: snap ? snap.removedCount : null,
      stayed: snap ? snap.stayedCount : null,
      arrived: snap ? snap.arrivedCount : null,
    })
    timer = setTimeout(clear, ATTRIBUTION_MS)
  }

  const unsub = useStore.subscribe(sync)
  return () => {
    unsub()
    clear()
  }
}
