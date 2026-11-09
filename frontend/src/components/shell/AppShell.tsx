import { useEffect } from 'react'
import { ClipboardList, ListChecks } from 'lucide-react'
import { startAttributionTrigger } from '@/lib/attributionTrigger'
import { startDecisionRecorder } from '@/lib/decisionRecorder'
import { startPipOpener } from '@/lib/pipOpener'
import { selectPendingCount, useStore } from '@/store'
import { NewCaseSheet } from '@/components/case/NewCaseSheet'
import { TaskingList } from '@/components/tasking/TaskingList'
import { EvidenceTimeline } from '@/components/timeline/EvidenceTimeline'
import { DebugPanel } from '@/components/dev/DebugPanel'
import { ConnectedStatusBar } from './ConnectedStatusBar'
import { Rail } from './Rail'
import { CommandBar } from './CommandBar'
import { Scrubber } from './Scrubber'
import { PipSlot, ReportSlot } from './Slots'
import { WhyCard } from '@/components/why/WhyCard'
import { AttributionLegend } from './AttributionLegend'
import { FoundBanner } from './FoundBanner'
import { Toaster } from './Toaster'

/**
 * Full-viewport operations screen. The map fills everything (layer 0); every panel floats over
 * it, so no panel can resize the map. Panel open/closed state lives in the store (`ui.panels`).
 */
export function AppShell({ map }: { map: React.ReactNode }) {
  const panels = useStore((s) => s.ui.panels)
  const setPanel = useStore((s) => s.setPanel)
  const pending = useStore(selectPendingCount)
  const hasEvidence = useStore((s) => s.evidence.order.length > 0)
  const caseId = useStore((s) => s.caseProfile?.case_id ?? null)
  const hasRequests = useStore((s) => s.requests.order.length > 0)
  useEffect(() => startPipOpener(), []) // the drone feed opens when a drone request is approved
  useEffect(() => startAttributionTrigger(), []) // selecting a card shows what it killed and kept
  useEffect(() => startDecisionRecorder(), []) // notes when each decision was confirmed, for the replay
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
          >
            {hasEvidence ? <EvidenceTimeline /> : undefined}
          </Rail>
        )}
        <Rail
          side="right"
          title="Tasking requests"
          icon={ListChecks}
          open={panels.right}
          onToggle={() => setPanel('right', !panels.right)}
          pendingCount={pending}
          empty="No requests yet. Recommended searches appear here for you to approve, edit or reject."
        >
          {hasRequests ? <TaskingList /> : undefined}
        </Rail>
        <PipSlot open={panels.pip} />
        <Scrubber />
        <CommandBar />
        <WhyCard />
        <AttributionLegend />
        <Toaster />
        <FoundBanner />
        <ReportSlot open={panels.report} caseId={caseId} onClose={() => setPanel('report', false)} />
        {import.meta.env.DEV && <DebugPanel />}
      </div>
    </div>
  )
}
