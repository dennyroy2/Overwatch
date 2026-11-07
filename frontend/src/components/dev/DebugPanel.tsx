import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { ghosts } from '@/stream/ghostBuffer'
import { perf } from '@/stream/perf'
import { attachCase, closeCase, openCase } from '@/stream/client'
import { demoCase } from '@/lib/demoCase'

/**
 * Dev-only. Live counts so the data path can be verified by eye. Ghost counters are read from the
 * non-React buffer on a timer, so this panel itself never re-renders per frame.
 */
export function DebugPanel() {
  const evidence = useStore((s) => s.evidence.order.length)
  const requests = useStore((s) => s.requests.order.length)
  const log = useStore((s) => s.log.length)
  const connection = useStore((s) => s.connection)
  const caseId = useStore((s) => s.caseProfile?.case_id)
  const [g, setG] = useState({ points: 0, frames: 0, fps: 0, frameAge: 0, workMs: 0, respawn: '-', peak: 0, typical: 0, halo: 0 })
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const id = setInterval(() => {
      setG({
        points: ghosts.count,
        frames: ghosts.frame,
        fps: Math.round(perf.fps),
        // How old the newest data frame is. ~0-200 ms with a 5 fps feed; much larger means the stream stalled.
        frameAge: ghosts.receivedAt ? Math.round(performance.now() - ghosts.receivedAt) : 0,
        workMs: +perf.workMs.toFixed(2),
        peak: perf.peakPerCell,
        typical: +perf.typicalPerCell.toFixed(1),
        halo: +perf.haloOpacity.toFixed(3),
        // Slots that were replaced in the newest frame ('all' = fallback while the backend sends no list).
        respawn: ghosts.allRespawned ? 'all' : ghosts.respawned ? String(ghosts.respawned.length) : '-',
      })
    }, 250)
    return () => clearInterval(id)
  }, [])

  const row = (k: string, v: string | number) => (
    <div className="flex justify-between gap-6">
      <span className="text-ink-3">{k}</span>
      <span data-testid={`dbg-${k}`} className="text-ink">{v}</span>
    </div>
  )
  if (!open) {
    return (
      <button
        data-testid="debug-pill"
        onClick={() => setOpen(true)}
        className="pointer-events-auto absolute left-1/2 top-[4.25rem] z-20 -translate-x-1/2 rounded-md border border-line bg-panel px-2 py-1 font-mono text-xs text-ink-2 shadow-panel hover:text-ink"
      >
        Debug · {connection.state}{g.fps > 0 ? ` · ${g.fps} fps` : ''}
      </button>
    )
  }
  return (
    <div
      data-testid="debug-panel"
      className="pointer-events-auto absolute top-[4.25rem] left-1/2 z-20 w-64 -translate-x-1/2 rounded-lg border border-line bg-panel p-3 font-mono text-xs shadow-panel"
    >
      {row('connection', `${connection.state}${connection.attempt ? ` #${connection.attempt}` : ''}`)}
      {row('case', caseId ?? '-')}
      {row('fps', g.fps)}
      {row('ghost points', g.points)}
      {row('frames', g.frames)}
      {row('frame age ms', g.frameAge)}
      {row('render ms', g.workMs)}
      {row('respawned', g.respawn)}
      {row('peak / cell', g.peak)}
      {row('typical / cell', g.typical)}
      {row('glow opacity', g.halo)}
      {row('evidence', evidence)}
      {row('requests', requests)}
      {row('log', log)}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button className="rounded-sm bg-control px-2 py-1 text-ink hover:bg-raised" onClick={() => setOpen(false)}>Hide</button>
        <button className="rounded-sm bg-control px-2 py-1 text-ink hover:bg-raised" onClick={() => openCase(demoCase())}>Open demo</button>
        <button className="rounded-sm bg-control px-2 py-1 text-ink hover:bg-raised" onClick={() => attachCase('case_doesnotexist')}>Unknown case</button>
        <button className="rounded-sm bg-control px-2 py-1 text-ink hover:bg-raised" onClick={closeCase}>Close</button>
      </div>
    </div>
  )
}
