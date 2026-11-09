// Open the fictional demo case from anywhere (debug panel, New case sheet, ?autostart=demo): create it, close
// the New case sheet so the evidence rail is visible, and let the demo tips arrive (see demoScript.ts).
import { demoCase } from '@/lib/demoCase'
import { postEvidence, restartDetector, startDemoTips, type DemoDeps } from '@/lib/demoScript'
import { openCase } from '@/stream/client'
import { useStore } from '@/store'

let cancelTips: (() => void) | null = null
let stopWatching: (() => void) | null = null

export function openDemo(): void {
  cancelTips?.()
  stopWatching?.()
  openCase(demoCase())
  const s = () => useStore.getState()
  s().setPanel('newCase', false)
  const deps: DemoDeps = {
    caseId: () => s().caseProfile?.case_id ?? null,
    evidenceCount: () => s().evidence.order.length,
    hasDroneEvidence: () => s().evidence.order.some((id) => s().evidence.byId[id]?.source === 'drone_ai'),
    lastSeenMs: () => Date.parse(s().caseProfile?.last_seen_time ?? '') || Date.now(),
    post: (ev) => postEvidence(ev),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    // While the connection is already down the header says so, and the restart starts the tips over: no second message.
    onError: (m) => { if (s().connection.state === 'live') s().pushToast('error', m) },
  }
  cancelTips = startDemoTips(deps)
  // The server restarted and the case was reopened from the start: the story starts over, so the tips do too.
  const restarted = restartDetector()
  stopWatching = useStore.subscribe((st) => {
    if (restarted(st.caseProfile?.case_id ?? null, st.evidence.order.length)) {
      cancelTips?.()
      cancelTips = startDemoTips(deps)
    }
  })
}
