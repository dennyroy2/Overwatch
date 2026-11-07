import { useMemo } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Check, X } from 'lucide-react'
import { visibleAt } from '@/lib/evidence'
import { areaCentre, decisionFor, splitRequests, type Request } from '@/lib/tasking'
import { clockTime } from '@/lib/ui'
import { cn } from '@/lib/utils'
import { flyToArea } from '@/map/camera'
import { getMap } from '@/map/mapRef'
import { useStore } from '@/store'
import { history } from '@/stream/history'
import { TaskingCard } from './TaskingCard'

/**
 * The right rail: requests waiting on the officer at full size (newest on top), and below them a quiet
 * "Decided" list with one line per request. Shows only what the store holds (hard rule 3), and while the view
 * is paused or replaying only what had arrived by that moment.
 */
export function TaskingList() {
  const order = useStore((s) => s.requests.order)
  const byId = useStore((s) => s.requests.byId)
  const evidence = useStore((s) => s.evidence.byId)
  const log = useStore((s) => s.log)
  const hoveredId = useStore((s) => s.ui.hoveredRequestId)
  const hoverRequest = useStore((s) => s.hoverRequest)
  const mode = useStore((s) => s.ui.replay.mode)
  const replayT = useStore((s) => s.replayView?.t ?? null)
  const selectEvidence = useStore((s) => s.selectEvidence)
  const setPanel = useStore((s) => s.setPanel)

  const { pending, decided } = useMemo(() => {
    const replay = { mode, t: replayT }
    return splitRequests(order, byId, (id) => visibleAt(replay, history.firstSeen.get(id)))
  }, [order, byId, mode, replayT])

  const showEvidence = (id: string) => {
    setPanel('left', true)
    selectEvidence(id) // the timeline scrolls the selected card into view
  }
  const showArea = (r: Request) => {
    const c = areaCentre(r)
    const map = getMap()
    if (c && map) flyToArea(map, c, 15.6)
  }

  return (
    <div className="flex flex-col gap-3">
      {pending.length === 0 && decided.length > 0 && (
        <p className="text-base text-ink-3">Nothing is waiting on you. New recommendations appear here.</p>
      )}
      <ol className="flex flex-col gap-2" aria-label="Requests waiting for a decision, newest first">
        <AnimatePresence initial={false}>
          {pending.map((id) => (
            <TaskingCard
              key={id}
              request={byId[id]}
              evidence={(byId[id].evidence_ids ?? []).flatMap((eid) => (evidence[eid] ? [evidence[eid]] : []))}
              hovered={hoveredId === id}
              onHover={hoverRequest}
              onShowEvidence={showEvidence}
              onShowArea={showArea}
            />
          ))}
        </AnimatePresence>
      </ol>

      {decided.length > 0 && (
        <section aria-label="Decided requests">
          <h3 className="mb-1.5 text-sm font-medium text-ink-2">
            Decided <span className="font-mono text-ink-3">{decided.length}</span>
          </h3>
          <ul className="flex flex-col gap-1">
            {decided.map((id) => {
              const r = byId[id]
              const d = decisionFor(log, r)
              const ok = r.status === 'approved'
              return (
                <li
                  key={id}
                  onMouseEnter={() => hoverRequest(id)}
                  onMouseLeave={() => hoverRequest(null)}
                  className={cn('flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm', hoveredId === id ? 'border-warm' : 'border-line')}
                  data-request-id={id}
                >
                  {ok ? <Check className="size-3.5 shrink-0 text-success" aria-hidden /> : <X className="size-3.5 shrink-0 text-danger" aria-hidden />}
                  <span className="min-w-0 flex-1 truncate text-ink">{r.asset}</span>
                  <span className={cn('text-xs', ok ? 'text-success' : 'text-danger')}>{ok ? 'Approved' : 'Rejected'}</span>
                  {d && (
                    <span className="font-mono text-xs text-ink-3" title={`${d.who}${d.reason ? `: ${d.reason}` : ''}`}>
                      {clockTime(d.time).slice(0, 5)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
