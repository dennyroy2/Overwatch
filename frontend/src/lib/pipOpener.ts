// Opens the drone feed when the officer approves a DRONE request (step 34), and only when the stream has confirmed it.
// Like the route animation, it reacts only to an approval it watched happen live: a request that arrives already
// approved (a page reload, a replay) does not pop the feed up. An edited approval opens it for the replacement asset.
import { decisionFor, effectiveAsset } from '@/lib/tasking'
import { requestState } from '@/lib/decision'
import { isDroneAsset } from '@/lib/footage'
import { useStore } from '@/store'

export function startPipOpener(): () => void {
  const seenWaiting = new Set<string>() // requests seen while they still waited on the officer
  const handled = new Set<string>() // approved requests already looked at

  const sync = () => {
    const s = useStore.getState()
    if (s.requests.order.length === 0) {
      seenWaiting.clear()
      handled.clear()
      return
    }
    if (s.ui.replay.mode !== 'live') return
    for (const id of s.requests.order) {
      const r = s.requests.byId[id]
      if (!r) continue
      const st = requestState(r, s.log, s.decisions[id])
      if (st === 'pending' || st === 'sending') seenWaiting.add(id)
      else if (st === 'approved' && !handled.has(id)) {
        handled.add(id)
        if (!seenWaiting.has(id)) continue
        const asset = effectiveAsset(r.asset, decisionFor(s.log, { asset: r.asset, status: 'approved' })?.reason)
        if (isDroneAsset(asset)) s.openPip(id)
      }
    }
  }

  sync()
  return useStore.subscribe(sync)
}
