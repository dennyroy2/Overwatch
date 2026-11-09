import { useStore } from '@/store'
import { CloseSearchControl } from './CloseSearchControl'
import { ExportMenu } from './ExportMenu'
import { StatusBar } from './StatusBar'

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')

function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`
}

/** Subscribes only to the slices the status bar reads. */
export function ConnectedStatusBar() {
  const name = useStore((s) => s.caseProfile?.name)
  const lastSeenTime = useStore((s) => s.caseProfile?.last_seen_time)
  const liveT = useStore((s) => s.ghostMeta.t)
  // Field feedback: an 'alive %' reads as the person's survival chance. Show the chance she is still in the
  // search area instead (1 - left_area), which is what planners call the area's share vs 'rest of world'.
  const leftArea = useStore((s) => s.ghostMeta.leftArea)
  // Paused or replaying: show the recorded moment, not the newest data.
  const replay = useStore((s) => (s.ui.replay.mode !== 'live' ? s.replayView : null))
  const mode = useStore((s) => s.ui.replay.mode)
  const connection = useStore((s) => s.connection.state)
  const setPanel = useStore((s) => s.setPanel)

  const simMs = replay ? (replay.simTime ?? undefined) : liveT ? Date.parse(liveT) : undefined
  const lastMs = lastSeenTime ? Date.parse(lastSeenTime) : undefined
  return (
    <StatusBar
      caseName={name}
      simClock={simMs === undefined ? undefined : new Date(simMs).toLocaleTimeString('en-CA', { hour12: false })}
      sinceLastSeen={simMs !== undefined && lastMs !== undefined ? hms((simMs - lastMs) / 1000) : undefined}
      inAreaFraction={leftArea == null ? undefined : 1 - leftArea}
      connection={connection}
      viewNote={mode === 'paused' ? 'Paused view' : mode === 'playing' ? 'Replaying' : undefined}
      actions={<><ExportMenu /><CloseSearchControl /></>}
      onNewCase={() => { setPanel('sheetCollapsed', false); setPanel('newCase', true) }}
    />
  )
}
