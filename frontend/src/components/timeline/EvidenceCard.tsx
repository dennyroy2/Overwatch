import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Sparkles } from 'lucide-react'
import { KIND_LABEL, SOURCE_LABEL, cardText, isAiText, isConfirmed, isParsing, mediaSrc } from '@/lib/evidence'
import { clockTime } from '@/lib/ui'
import { cn } from '@/lib/utils'
import type { Evidence, WithId } from '@/types'
import { SOURCE_ICON } from './icons'

export interface EvidenceCardProps {
  evidence: WithId<Evidence>
  /** When this screen first saw the card (its "entered" time), ms. */
  seenAt: number
  now: number
  selected: boolean
  hovered: boolean
  /** "Why?" mode (step 37): this card is behind the selected cluster (lit), or is not (dim). null when the mode is off. */
  why?: 'lit' | 'dim' | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
}

const EASE = [0.16, 1, 0.3, 1] as const

/**
 * One evidence card. Because the store upserts by id, a card can CHANGE IN PLACE: an officer's note first
 * arrives as plain text, then the AI's structured version arrives with the same id and the card fills in
 * (kind, summary, reliability, pin) with a brief cyan flash. While the note is waiting it shows a quiet cyan
 * "Parsing" state that settles to a plain note if nothing arrives.
 */
export function EvidenceCard({ evidence: e, seenAt, now, selected, hovered, why = null, onSelect, onHover }: EvidenceCardProps) {
  const reduced = useReducedMotion()
  const ref = useRef<HTMLLIElement>(null)
  const parsing = isParsing(e, seenAt, now)
  const ai = isAiText(e)
  const SourceIcon = SOURCE_ICON[e.source]
  const src = mediaSrc(e)
  const [imageFailed, setImageFailed] = useState(false) // a missing crop hides itself; it never breaks the card

  // Flash when a plain note becomes a structured card.
  const prevKind = useRef(e.kind)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (prevKind.current === 'note' && e.kind !== 'note') {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 1400)
      prevKind.current = e.kind
      return () => clearTimeout(t)
    }
    prevKind.current = e.kind
  }, [e.kind])

  // Selecting a mark on the map brings its card into view.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [selected, reduced])

  return (
    <motion.li
      ref={ref}
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.26, ease: EASE }}
      data-evidence-id={e.id}
      data-kind={e.kind}
      data-why={why ?? undefined}
    >
      <button
        type="button"
        onClick={() => onSelect(e.id)}
        onMouseEnter={() => onHover(e.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(e.id)}
        onBlur={() => onHover(null)}
        aria-pressed={selected}
        className={cn(
          'w-full rounded-md border bg-panel p-2.5 text-left transition-colors',
          selected ? 'border-amber bg-raised' : why === 'lit' ? 'border-ai bg-raised shadow-[0_0_0_1px_var(--ow-cyan-dim)]' : flash ? 'border-ai' : hovered ? 'border-warm' : 'border-line',
          why === 'dim' && 'opacity-45',
        )}
      >
        <div className="flex items-center gap-2">
          <SourceIcon className="size-4 shrink-0 text-ink-2" aria-label={SOURCE_LABEL[e.source]} />
          <span className="rounded-sm bg-raised px-1.5 py-0.5 text-xs font-medium text-ink">{KIND_LABEL[e.kind]}</span>
          {!isConfirmed(e) && <span className="rounded-sm bg-amber-wash px-1.5 py-0.5 text-xs text-amber">Unconfirmed</span>}
          <span className="ml-auto font-mono text-xs text-ink-3" title="When it happened">{clockTime(e.time)}</span>
        </div>

        <p className={cn('mt-2 text-md leading-snug', ai ? 'text-ai' : 'text-ink')}>
          {ai && <Sparkles className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />}
          {cardText(e)}
        </p>

        {parsing && (
          <div className="mt-2" role="status" aria-label="The AI is turning this note into a structured card">
            <div className="flex items-center gap-1.5 text-sm text-ai">
              <Sparkles className="size-3.5" aria-hidden />
              Parsing
            </div>
            <div className="mt-1 h-px overflow-hidden rounded-sm bg-ai-wash">
              <span className="ow-shimmer block h-full w-1/3 bg-ai" />
            </div>
          </div>
        )}

        {src && !imageFailed && (
          <img
            src={src}
            alt={`Crop from the drone frame: ${cardText(e)}`}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="mx-auto mt-2 block max-h-32 w-auto max-w-full rounded-sm border border-line"
          />
        )}

        <p className="mt-1.5 font-mono text-xs text-ink-3" title="When it was entered on this screen">{clockTime(seenAt)}</p>
      </button>
    </motion.li>
  )
}
