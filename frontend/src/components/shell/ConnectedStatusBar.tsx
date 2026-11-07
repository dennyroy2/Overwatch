import { useStore } from '@/store'
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
  const t = useStore((s) => s.ghostMeta.t)
  const alive = useStore((s) => s.ghostMeta.aliveFraction)
  const connection = useStore((s) => s.connection.state)
  const setPanel = useStore((s) => s.setPanel)

  const simMs = t ? Date.parse(t) : undefined
  const lastMs = lastSeenTime ? Date.parse(lastSeenTime) : undefined
  return (
    <StatusBar
      caseName={name}
      simClock={simMs === undefined ? undefined : new Date(simMs).toLocaleTimeString('en-CA', { hour12: false })}
      sinceLastSeen={simMs !== undefined && lastMs !== undefined ? hms((simMs - lastMs) / 1000) : undefined}
      aliveFraction={alive ?? undefined}
      connection={connection}
      onNewCase={() => setPanel('newCase', true)}
    />
  )
}
