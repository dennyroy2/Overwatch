// "Why?" mode's data, from the store (step 37): the selected cluster and what the engine says is behind it. One place
// for the map layers, the evidence pins, and the React card, so they can never disagree.
import { useMemo } from 'react'
import { visibleAt } from '@/lib/evidence'
import { buildWhy, type WhyView } from '@/lib/why'
import { history } from '@/stream/history'
import { selectDisplayedClusters, useStore, type StoreState } from '@/store'

/** Not a hook: for the map layers, which are not React. Null when no cluster is selected. */
export function whyFor(s: StoreState): WhyView | null {
  const id = s.ui.selectedClusterId
  if (!id) return null
  const cluster = selectDisplayedClusters(s).find((c) => c.id === id) ?? null
  const replay = { mode: s.ui.replay.mode, t: s.replayView?.t ?? null }
  return buildWhy(cluster, s.evidence.byId, s.evidence.order, (eid) => visibleAt(replay, history.firstSeen.get(eid)))
}

/** The ids of the evidence behind the selected cluster, or null when "Why?" mode is off. */
export function whyLitIds(s: StoreState): Set<string> | null {
  const w = whyFor(s)
  return w ? new Set(w.items.map((i) => i.id)) : null
}

export function useWhy(): WhyView | null {
  const clusters = useStore(selectDisplayedClusters)
  const selectedId = useStore((s) => s.ui.selectedClusterId)
  const byId = useStore((s) => s.evidence.byId)
  const order = useStore((s) => s.evidence.order)
  const mode = useStore((s) => s.ui.replay.mode)
  const t = useStore((s) => s.replayView?.t ?? null)
  return useMemo(() => {
    if (!selectedId) return null
    const cluster = clusters.find((c) => c.id === selectedId) ?? null
    return buildWhy(cluster, byId, order, (eid) => visibleAt({ mode, t }, history.firstSeen.get(eid)))
  }, [clusters, selectedId, byId, order, mode, t])
}
