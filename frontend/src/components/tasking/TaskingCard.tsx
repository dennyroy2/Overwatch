import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Check, ChevronDown, Crosshair, Minus, Sparkles, X } from 'lucide-react'
import { KIND_LABEL } from '@/lib/evidence'
import { constraintRows, gainPercent, type ConstraintState, type Request } from '@/lib/tasking'
import { cn } from '@/lib/utils'
import type { Evidence, WithId } from '@/types'
import { KIND_ICON } from '@/components/timeline/icons'
import { GainArc } from './GainArc'

export interface TaskingCardProps {
  request: Request
  /** Evidence the request cites that this screen has (a cited id it has not seen is left out, never invented). */
  evidence: WithId<Evidence>[]
  hovered: boolean
  onHover: (id: string | null) => void
  onShowEvidence: (id: string) => void
  onShowArea: (r: Request) => void
}

const EASE = [0.16, 1, 0.3, 1] as const

const STATE_STYLE: Record<ConstraintState, { icon: typeof Check; cls: string; word: string }> = {
  ok: { icon: Check, cls: 'text-success', word: 'passed' },
  fail: { icon: X, cls: 'text-danger', word: 'failed' },
  unknown: { icon: Minus, cls: 'text-ink-3', word: 'not reported' },
}

/**
 * One tasking request. Every field the backend sends is shown: asset and duration, the expected-gain gauge,
 * the reasons (AI-written, so cyan), the four constraint checks, the other options (collapsed) and chips for the
 * evidence behind it. Hovering or focusing the card outlines its target area on the map. Approve, Edit and
 * Reject arrive in step 22.
 */
export function TaskingCard({ request: r, evidence, hovered, onHover, onShowEvidence, onShowArea }: TaskingCardProps) {
  const reduced = useReducedMotion()
  const [more, setMore] = useState(false)
  const alternatives = r.alternatives ?? []
  const pct = gainPercent(r)

  return (
    <motion.li
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={reduced ? undefined : { opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: reduced ? 0 : 0.3, ease: EASE }}
      data-request-id={r.id}
    >
      <article
        aria-label={`${r.asset}, covers ${pct}% in ${r.duration_min} minutes`}
        onMouseEnter={() => onHover(r.id)}
        onMouseLeave={() => onHover(null)}
        onFocusCapture={() => onHover(r.id)}
        onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHover(null) }}
        className={cn('rounded-md border bg-panel p-3 transition-colors', hovered ? 'border-amber' : 'border-line')}
      >
        <header className="flex items-center gap-2">
          <h3 className="text-md font-medium text-ink">{r.asset}</h3>
          <span className="rounded-sm bg-amber-wash px-1.5 py-0.5 text-xs text-amber">Pending</span>
          <button
            type="button"
            onClick={() => onShowArea(r)}
            aria-label={`Show ${r.asset}'s search area on the map`}
            title="Show on the map"
            className="ml-auto grid size-6 place-items-center rounded-md text-ink-2 hover:bg-raised hover:text-ink"
          >
            <Crosshair className="size-3.5" aria-hidden />
          </button>
        </header>

        <div className="mt-2.5 flex items-center gap-3">
          <GainArc gain={r.expected_gain} />
          <p className="text-base leading-snug text-ink-2">
            Covers <span className="font-mono text-amber">{pct}%</span> of remaining probability in{' '}
            <span className="whitespace-nowrap font-mono text-ink">{r.duration_min} min</span>
          </p>
        </div>

        {r.reasons.length > 0 && (
          <ul className="mt-2.5 flex flex-col gap-1">
            {r.reasons.map((reason, i) => (
              <li key={i} className="flex gap-1.5 text-md leading-snug text-ai">
                <Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}

        <ul className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1" aria-label="Constraint checks">
          {constraintRows(r).map(({ key, label, state }) => {
            const { icon: Icon, cls, word } = STATE_STYLE[state]
            return (
              <li key={key} className={cn('flex items-center gap-1.5 text-sm', cls)}>
                <Icon className="size-3.5 shrink-0" strokeWidth={2.4} aria-hidden />
                <span className="text-ink-2">{label}</span>
                <span className="sr-only">{word}</span>
              </li>
            )
          })}
        </ul>

        {evidence.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-3">Based on</span>
            {evidence.map((e) => {
              const Icon = KIND_ICON[e.kind]
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onShowEvidence(e.id)}
                  title={`Show this ${KIND_LABEL[e.kind].toLowerCase()} in the case timeline`}
                  className="inline-flex items-center gap-1 rounded-sm border border-line bg-raised px-1.5 py-0.5 text-xs text-ink-2 hover:border-warm hover:text-ink"
                >
                  <Icon className="size-3" aria-hidden />
                  {KIND_LABEL[e.kind]}
                </button>
              )
            })}
          </div>
        )}

        {alternatives.length > 0 && (
          <div className="mt-2.5 border-t border-line pt-2">
            <button
              type="button"
              onClick={() => setMore((m) => !m)}
              aria-expanded={more}
              className="flex w-full items-center gap-1 text-sm text-ink-2 hover:text-ink"
            >
              <ChevronDown className={cn('size-3.5 transition-transform', more && 'rotate-180')} aria-hidden />
              Other options
              <span className="font-mono text-xs text-ink-3">{alternatives.length}</span>
            </button>
            {more && (
              <ul className="mt-1.5 flex flex-col gap-1 pl-5">
                {alternatives.map((a, i) => (
                  <li key={i} className="list-disc text-sm text-ai marker:text-ink-3">{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </article>
    </motion.li>
  )
}
