import { useEffect, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { KIND_LABEL, reliabilityOf } from '@/lib/evidence'
import { TYPE_CPS, typedLength } from '@/lib/why'
import { useWhy } from '@/lib/whySelect'
import { clockTime } from '@/lib/ui'
import { useStore } from '@/store'

/**
 * "Why?" mode's story card (step 37): the engine explaining why the swarm is in this place. The story is the
 * cluster's own `story`, typed out in cyan (the AI's colour); while there is none it says "Story pending" and never
 * makes anything up. Below it, the evidence the engine says is behind this place; the same cards light up in the left
 * rail and the same pins glow on the map. Escape (or the X) leaves.
 */
export function WhyCard() {
  const why = useWhy()
  const seq = useStore((s) => s.ui.whySeq)
  const selectCluster = useStore((s) => s.selectCluster)
  const selectEvidence = useStore((s) => s.selectEvidence)
  const selectedEvidenceId = useStore((s) => s.ui.selectedEvidenceId)
  if (!why) return null
  const pct = Math.round(why.cluster.probability * 100)
  return (
    <section
      aria-label="Why this place"
      data-testid="why-card"
      className="pointer-events-auto absolute left-[calc(var(--ow-rail-width)+1.5rem)] top-[10.25rem] z-20 w-[25rem] max-h-[calc(100%-19rem)] overflow-y-auto rounded-lg border border-line bg-panel shadow-panel"
    >
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">Why this place?</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            <span className="font-mono text-amber" data-testid="why-pct">{pct}%</span> of the remaining probability
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => selectCluster(null)} aria-label="Leave Why mode (Esc)"><X /></Button>
      </div>

      <div className="px-4 py-3">
        {why.story ? (
          <TypedStory key={seq} text={why.story} />
        ) : (
          <p className="text-sm italic text-ink-3" data-testid="why-story-pending">Story pending</p>
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <h3 className="text-sm font-medium text-ink-2">
          Evidence behind it <span className="ml-1 font-mono text-ink-3" data-testid="why-count">{why.items.length}</span>
        </h3>
        {why.items.length === 0 ? (
          <p className="mt-1.5 text-sm text-ink-3" data-testid="why-no-evidence">No evidence is attached to this place.</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {why.items.map(({ id, evidence: e, place }) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => selectEvidence(selectedEvidenceId === id ? null : id)}
                  aria-pressed={selectedEvidenceId === id}
                  data-testid="why-item"
                  data-evidence-id={id}
                  className="flex w-full items-start gap-2 rounded-md border border-line bg-raised px-2.5 py-1.5 text-left hover:border-ai"
                >
                  <span className="mt-0.5 shrink-0 rounded-sm bg-panel px-1.5 py-0.5 text-xs font-medium text-ink">{KIND_LABEL[e.kind]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug text-ink">{e.summary}</span>
                    <span className="mt-0.5 block font-mono text-xs text-ink-3">
                      {clockTime(e.time)} · {Math.round(reliabilityOf(e) * 100)}%{place ? '' : ' · no place'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {why.missing > 0 && <p className="mt-1.5 text-xs text-ink-3">{why.missing} more listed by the engine, not on this screen yet.</p>}
      </div>
      <p className="border-t border-line px-4 py-2 text-xs text-ink-3">Esc to leave. The map is dimmed; the arcs show where each piece of evidence is.</p>
    </section>
  )
}

/** The story, typed out at TYPE_CPS characters a second in cyan; all at once under reduced motion. Remounts per click (`key`). */
function TypedStory({ text }: { text: string }) {
  const reduced = useReducedMotion()
  const [start] = useState(() => performance.now()) // when this story began to type (a new click remounts it)
  const [now, setNow] = useState(start)
  const total = text.length
  useEffect(() => {
    if (reduced) return
    let raf = 0
    const tick = () => {
      const t = performance.now()
      setNow(t)
      if (typedLength(t - start, total) < total) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [total, reduced, start])
  const n = reduced ? total : typedLength(now - start, total, TYPE_CPS)
  const typing = n < total
  return (
    <>
      {/* The whole story is there for a screen reader from the start; the typed copy is only for the eyes. */}
      <p className="sr-only" data-testid="why-story-full">{text}</p>
      <p aria-hidden className="text-md leading-snug text-ai" data-testid="why-story">
        <Sparkles className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
        {text.slice(0, n)}
        {typing && <span className="ow-caret" />}
      </p>
    </>
  )
}
