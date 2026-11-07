import { useState } from 'react'
import { ClipboardList, ListChecks } from 'lucide-react'
import { StatusBar, type StatusBarProps } from './StatusBar'
import { Rail } from './Rail'
import { CommandBar } from './CommandBar'
import { PipSlot, ReportSlot } from './Slots'

/**
 * Full-viewport operations screen. The map fills everything (layer 0); every panel floats over
 * it, so no panel can resize the map. Region contents arrive in later steps; each region
 * already renders an empty state.
 */
export function AppShell({
  map,
  status,
  initial,
}: {
  map: React.ReactNode
  status?: StatusBarProps
  /** Dev review only: start with panels open. */
  initial?: { pip?: boolean; report?: boolean; collapsed?: boolean; pending?: number }
}) {
  const [leftOpen, setLeftOpen] = useState(!initial?.collapsed)
  const [rightOpen, setRightOpen] = useState(!initial?.collapsed)
  const [reportOpen, setReportOpen] = useState(initial?.report ?? false)
  return (
    <div className="relative h-full w-full overflow-hidden bg-ground">
      <div className="absolute inset-0 z-0">{map}</div>
      <div className="pointer-events-none absolute inset-0">
        <StatusBar {...status} />
        <Rail
          side="left"
          title="Case timeline"
          icon={ClipboardList}
          open={leftOpen}
          onToggle={() => setLeftOpen((v) => !v)}
          empty="No evidence yet. Tips, sightings and search results appear here as they arrive."
        />
        <Rail
          side="right"
          title="Tasking requests"
          icon={ListChecks}
          open={rightOpen}
          pendingCount={initial?.pending}
          onToggle={() => setRightOpen((v) => !v)}
          empty="No requests yet. Recommended searches appear here for you to approve, edit or reject."
        />
        <PipSlot open={initial?.pip ?? false} />
        <CommandBar />
        <ReportSlot open={reportOpen} onClose={() => setReportOpen(false)} />
      </div>
    </div>
  )
}
