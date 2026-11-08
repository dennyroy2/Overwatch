import { DroneFeed } from '@/components/pip/DroneFeed'
import { useStore } from '@/store'
import { ReportView } from '@/panels/ReportView'

/** Drone feed picture-in-picture. Opens when a drone request is approved (lib/pipOpener.ts, step 34). */
export function PipSlot({ open }: { open: boolean }) {
  const requestId = useStore((s) => s.ui.pipRequestId)
  const closePip = useStore((s) => s.closePip)
  if (!open) return null
  return <DroneFeed requestId={requestId} onClose={closePip} />
}

/**
 * Report slot: Varad's `ReportView` (frontend/src/panels/ReportView.tsx, imported only, never edited: hard rule 1).
 * It fetches GET /report/{caseId} itself. Opened by Close search after the server accepted the close.
 */
export function ReportSlot({ open, caseId, onClose }: { open: boolean; caseId: string | null; onClose: () => void }) {
  if (!open || !caseId) return null
  return (
    <section aria-label="Search report" className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-ground/80 p-6">
      <ReportView caseId={caseId} onClose={onClose} />
    </section>
  )
}
