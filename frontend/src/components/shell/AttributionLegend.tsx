import { useStore } from '@/store'

const n = (v: number | null) => (v ?? 0).toLocaleString()

/**
 * Says what the red and cyan dots on the map are while a card's overlay is showing (step 36). It is honest about the
 * limit: the engine does not report which card caused which change, so changes are credited to the latest card.
 */
export function AttributionLegend() {
  const a = useStore((s) => s.ui.attribution)
  if (!a) return null
  const known = a.removed !== null && a.stayed !== null && a.arrived !== null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="attribution-legend"
      className="pointer-events-none absolute bottom-[calc(var(--ow-dock)+0.5rem)] left-1/2 z-20 -translate-x-1/2 rounded-md border border-line bg-panel/95 px-3 py-2 shadow-panel"
    >
      {known ? (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink">
            {a.removed === 0 ? (
              <span>This card removed no ghosts.</span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-full bg-[#c9544a]" />
                <span className="font-mono" data-testid="attribution-removed">{n(a.removed)}</span> removed
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2 rounded-full bg-ai/45" />
              <span className="font-mono" data-testid="attribution-stayed">{n(a.stayed)}</span> stayed
            </span>
            {(a.arrived ?? 0) > 0 && (
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-2 rounded-full bg-ai" />
                <span className="font-mono" data-testid="attribution-arrived">{n(a.arrived)}</span> arrived
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">Changes are credited to the latest card, so this is approximate.</p>
        </>
      ) : (
        <p className="text-sm text-ink-2">No record of what this card changed. It arrived before this screen was open.</p>
      )}
    </div>
  )
}
