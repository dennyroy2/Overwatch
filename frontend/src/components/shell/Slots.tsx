import { Drone } from 'lucide-react'
import { ReportView } from '@/panels/ReportView'

/** Drone feed picture-in-picture. Opens when a drone request is approved (step 34). */
export function PipSlot({ open }: { open: boolean }) {
  if (!open) return null
  return (
    <section
      aria-label="Drone feed"
      className="pointer-events-auto absolute bottom-[var(--ow-dock)] right-[calc(var(--ow-rail-width)+1.5rem)] z-10 w-[24rem] overflow-hidden rounded-lg border border-line bg-panel shadow-panel"
    >
      <div className="flex h-9 items-center gap-2 border-b border-line px-3">
        <Drone className="size-4 text-ink-2" aria-hidden />
        <span className="font-mono text-sm text-ink-2">Drone feed</span>
      </div>
      <div className="grid aspect-video place-items-center bg-ground">
        <p className="max-w-[28ch] text-center text-base text-ink-3">
          No drone feed yet. It opens when you approve a drone request.
        </p>
      </div>
    </section>
  )
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
