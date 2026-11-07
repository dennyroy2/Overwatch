import { Drone, FileText, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

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
 * Report slot. Varad's `frontend/src/panels/ReportView.tsx` fills this (props: { caseId, onClose }).
 * His file is not on main yet, so this is a placeholder. The real import is wired in step 24.
 * Never create or edit the panels/ folder (hard rule 1).
 */
export function ReportSlot({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null
  return (
    <section
      aria-label="Search report"
      className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-ground/80 p-6"
    >
      <div className="w-full max-w-xl rounded-lg border border-line bg-panel p-5 shadow-panel">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-ink-2" aria-hidden />
          <h2 className="text-lg font-medium text-ink">Search report</h2>
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close report">
            <X />
          </Button>
        </div>
        <p className="mt-3 max-w-[60ch] text-base text-ink-2">
          The report view isn't available yet. It will load here when the report panel is added.
        </p>
      </div>
    </section>
  )
}
