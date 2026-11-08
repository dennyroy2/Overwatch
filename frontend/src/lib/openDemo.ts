// Open the fictional demo case from anywhere (debug panel, New case sheet, ?autostart=demo): create it, close
// the New case sheet so the evidence rail is visible, and let the demo tips arrive (see demoScript.ts).
import { demoCase } from '@/lib/demoCase'
import { postEvidence, startDemoTips } from '@/lib/demoScript'
import { openCase } from '@/stream/client'
import { useStore } from '@/store'

let cancelTips: (() => void) | null = null

export function openDemo(): void {
  cancelTips?.()
  openCase(demoCase())
  const s = () => useStore.getState()
  s().setPanel('newCase', false)
  cancelTips = startDemoTips({
    caseId: () => s().caseProfile?.case_id ?? null,
    evidenceCount: () => s().evidence.order.length,
    lastSeenMs: () => Date.parse(s().caseProfile?.last_seen_time ?? '') || Date.now(),
    post: (ev) => postEvidence(ev),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onError: (m) => s().pushToast('error', m),
  })
}
