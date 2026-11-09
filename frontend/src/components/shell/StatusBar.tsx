import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { connectionLabel, type ConnectionState } from './types'

export interface StatusBarProps {
  caseName?: string
  /** Pre-formatted, e.g. "01:12:30". Undefined shows the empty placeholder. */
  sinceLastSeen?: string
  simClock?: string
  /** Chance the person is still inside the search area (1 - left_area). */
  inAreaFraction?: number
  connection?: ConnectionState
  onNewCase?: () => void
  /** Extra controls at the right end (Close search). */
  actions?: React.ReactNode
  /** Shown when the view is paused or replaying, so a frozen picture is never mistaken for the live one. */
  viewNote?: string
}

const dot: Record<ConnectionState, string> = {
  idle: 'bg-ink-3',
  connecting: 'bg-amber motion-safe:animate-pulse',
  live: 'bg-success',
  reconnecting: 'bg-amber motion-safe:animate-pulse',
  not_found: 'bg-danger',
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-sm text-ink-3">{label}</span>
      <span className="font-mono text-md text-ink">{value}</span>
    </div>
  )
}

export function StatusBar({
  caseName,
  sinceLastSeen,
  simClock,
  inAreaFraction,
  connection = 'idle',
  onNewCase,
  actions,
  viewNote,
}: StatusBarProps) {
  return (
    <header className="pointer-events-auto absolute inset-x-3 top-3 z-20 flex h-11 items-center gap-6 rounded-lg border border-line bg-panel px-4 shadow-panel">
      <div className="flex items-baseline gap-3">
        <span className="text-lg font-semibold tracking-tight text-ink">Overwatch</span>
        <span className={cn('text-md', caseName ? 'text-ink' : 'text-ink-3')}>{caseName ?? 'No case open'}</span>
      </div>
      <div className="ml-auto flex items-center gap-6">
        <Readout label="Last seen" value={sinceLastSeen ?? '--:--:--'} />
        <Readout label="Sim time" value={simClock ?? '--:--:--'} />
        <Readout label="In search area" value={inAreaFraction === undefined ? '--%' : `${Math.round(inAreaFraction * 100)}%`} />
        <div className="flex items-center gap-2" role="status" aria-live="polite">
          <span className={cn('size-2 rounded-full', dot[connection])} aria-hidden />
          <span className="text-sm text-ink-2">{connectionLabel[connection]}</span>
        </div>
        {viewNote && (
          <span className="rounded-sm bg-amber-wash px-2 py-0.5 text-sm font-medium text-amber" role="status" data-testid="view-note">
            {viewNote}
          </span>
        )}
        {actions}
        {onNewCase && (
          <Button variant="secondary" size="sm" onClick={onNewCase}>
            <Plus data-icon="inline-start" />
            New case
          </Button>
        )}
      </div>
    </header>
  )
}
