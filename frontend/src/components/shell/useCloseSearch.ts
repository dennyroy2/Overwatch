import { useCallback } from 'react'
import { CloseError, closeBody, sendClose } from '@/lib/close'
import { useStore } from '@/store'

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
    return true
  }, [])
}
