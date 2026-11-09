// Notes the moment the stream confirms each decision (step 38), so a replay can show a request still waiting until
// then. The store only holds the current state; the recording needs the time it changed. A request that arrives
// already decided (a reload) is not noted: a replay shows it decided from the moment it appears.
import { requestState } from '@/lib/decision'
import { history } from '@/stream/history'
import { useStore } from '@/store'

export function startDecisionRecorder(): () => void {
  const sync = () => {
    const s = useStore.getState()
    for (const id of s.requests.order) {
      const r = s.requests.byId[id]
      if (!r || history.decisions.has(id)) continue
      const st = requestState(r, s.log, s.decisions[id])
      if (st !== 'approved' && st !== 'rejected') continue
      // Only a decision WATCHED happening: the request was seen waiting first (it has a first-seen time before now).
      if (history.firstSeen.has(id)) history.noteDecision(performance.now(), id, st)
    }
  }
  return useStore.subscribe(sync)
}
