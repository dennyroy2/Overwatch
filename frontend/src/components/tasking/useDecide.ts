import { useCallback } from 'react'
import { DecisionError, sendDecision } from '@/lib/decision'
import type { Decision } from '@/types'
import { useStore } from '@/store'

/** How long to wait for the stream to confirm a decision before telling the officer it is slow. */
export const CONFIRM_SLOW_MS = 10_000

/**
 * Send a decision. The card goes to "sending" (a spinner) and changes only when the stream confirms. If the POST
 * fails the click is rolled back and a toast explains why. Resolves true when the server accepted it.
 */
export function useDecide() {
  return useCallback(async (asset: string, body: Decision): Promise<boolean> => {
    const s = useStore.getState()
    const verb = body.approved ? 'approve' : 'reject'
    s.beginDecision(body.request_id, body.approved ? 'approved' : 'rejected')
    try {
      await sendDecision(body)
    } catch (err) {
      useStore.getState().endDecision(body.request_id)
      const why = err instanceof DecisionError ? err.message : 'Something went wrong'
      useStore.getState().pushToast('error', `Could not ${verb} ${asset}. ${why}. Nothing was changed.`)
      return false
    }
    setTimeout(() => {
      const st = useStore.getState()
      const r = st.requests.byId[body.request_id]
      // Still waiting: the request is still pending and our click is still outstanding.
      if (r && (r.status ?? 'pending') === 'pending' && st.decisions[body.request_id]) {
        const confirmed = st.log.slice(st.decisions[body.request_id].baseline).some((e) => e.action === 'decision' && e.detail.startsWith(`${asset}: `))
        if (!confirmed) st.pushToast('info', `Your decision on ${asset} was sent, but the server has not confirmed it yet.`)
      }
    }, CONFIRM_SLOW_MS)
    return true
  }, [])
}
