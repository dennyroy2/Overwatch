import { ClipboardList, ListChecks } from 'lucide-react'
import { selectPendingCount, useStore } from '@/store'
import { NewCaseSheet } from '@/components/case/NewCaseSheet'
import { DebugPanel } from '@/components/dev/DebugPanel'
import { ConnectedStatusBar } from './ConnectedStatusBar'
import { Rail } from './Rail'
import { CommandBar } from './CommandBar'
import { Scrubber } from './Scrubber'
import { PipSlot, ReportSlot } from './Slots'

/**
 * Full-viewport operations screen. The map fills everything (layer 0); every panel floats over
 * it, so no panel can resize the map. Panel open/closed state lives in the store (`ui.panels`).
 */
export function AppShell({ map }: { map: React.ReactNode }) {
  const panels = useStore((s) => s.ui.panels)
  const setPanel = useStore((s) => s.setPanel)
  const pending = useStore(selectPendingCount)
  return (
    <div className="relative h-full w-full overflow-hidden bg-ground">
      <div className="absolute inset-0 z-0">{map}</div>
      <div className="pointer-events-none absolute inset-0">
        <ConnectedStatusBar />
        {panels.newCase ? (
          <NewCaseSheet />
        ) : (
          <Rail
            side="left"
            title="Case timeline"
            icon={ClipboardList}
            open={panels.left}
            onToggle={() => setPanel('left', !panels.left)}
            empty="No evidence yet. Tips, sightings and search results appear here as they arrive."
          />
        )}
        <Rail
          side="right"
          title="Tasking requests"
          icon={ListChecks}
          open={panels.right}
          onToggle={() => setPanel('right', !panels.right)}
          pendingCount={pending}
          empty="No requests yet. Recommended searches appear here for you to approve, edit or reject."
        />
        <PipSlot open={panels.pip} />
        <Scrubber />
        <CommandBar />
        <ReportSlot open={panels.report} onClose={() => setPanel('report', false)} />
        {import.meta.env.DEV && <DebugPanel />}
      </div>
    </div>
  )
}
