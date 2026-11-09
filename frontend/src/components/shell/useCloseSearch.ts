import { useCallback } from 'react'
import { CloseError, closeBody, closedOutcome, sendClose } from '@/lib/close'
import { stopDemo } from '@/lib/openDemo'
import { useStore } from '@/store'
import { stopStream } from '@/stream/client'

const CONFIRM_WAIT_MS = 2500

/**
 * The subject was confirmed found, so the simulation has nothing left to do: stop the stream and the demo's own tips,
 * leaving the screen as it is. The stream is stopped only once it has delivered the 'search closed' entry (the header and
 * the possible-match banner read it from there), or after a short wait if that never arrives.
 */
function stopSimulationOnceClosed(): void {
  const stop = () => { stopDemo(); stopStream() }
  if (closedOutcome(useStore.getState().log)) return stop()
  let timer: ReturnType<typeof setTimeout> | null = null
  const unsub = useStore.subscribe((s) => { if (closedOutcome(s.log)) finish() })
  const finish = () => { if (timer) clearTimeout(timer); unsub(); stop() }
  timer = setTimeout(finish, CONFIRM_WAIT_MS)
}

/**
 * Close the search as the officer states it. POST first, then show (hard rule 3): the report opens only after the
 * server accepted the request, and a failure leaves the case open with an error toast so the officer can retry.
 * Resolves true when the search was closed.
 */
export function useCloseSearch() {
  return useCallback(async (found: boolean, note = ''): Promise<boolean> => {
    const s = useStore.getState()
    const caseId = s.caseProfile?.case_id
    if (!caseId || s.closing) return false
    s.setClosing(true)
    try {
      await sendClose(caseId, closeBody(found, note))
    } catch (err) {
      const why = err instanceof CloseError ? err.message : 'Something went wrong'
      useStore.getState().pushToast('error', `Could not close the search. ${why}. The case is still open.`)
      useStore.getState().setClosing(false)
      return false
    }
    useStore.getState().setClosing(false)
    useStore.getState().setPanel('report', true)
    if (found) stopSimulationOnceClosed()
    return true
  }, [])
}
