import type { LucideIcon } from 'lucide-react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RailProps {
  side: 'left' | 'right'
  title: string
  icon: LucideIcon
  open: boolean
  onToggle: () => void
  /** Items waiting on the officer. Shown on the collapsed strip so nothing is hidden. */
  pendingCount?: number
  /** Short, actionable empty state shown when `children` is absent. */
  empty: string
  children?: React.ReactNode
}

const STRIP = '3rem'

/**
 * A rail floats OVER the map (absolute, never in the layout flow), so opening or closing it
 * can never resize the map canvas. Collapsed, it leaves a thin icon strip with a count so a
 * new pending item is never invisible.
 */
export function Rail({ side, title, icon: Icon, open, onToggle, pendingCount = 0, empty, children }: RailProps) {
  const Collapse = side === 'left' ? ChevronLeft : ChevronRight
  const Expand = side === 'left' ? ChevronRight : ChevronLeft
  const attention = !open && pendingCount > 0
  return (
    <aside
      aria-label={title}
      className={cn(
        'pointer-events-auto absolute bottom-[var(--ow-dock)] top-[4.25rem] z-10 overflow-hidden rounded-lg border bg-panel shadow-panel',
        'transition-[width] duration-[var(--ow-dur-base)] ease-[var(--ow-ease-out)]',
        side === 'left' ? 'left-3' : 'right-3',
        attention ? 'border-amber' : 'border-line',
      )}
      style={{ width: open ? 'var(--ow-rail-width)' : STRIP }}
    >
      {/* Collapsed strip */}
      {!open && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={false}
          aria-label={`Open ${title}${pendingCount ? `, ${pendingCount} pending` : ''}`}
          className="flex h-full w-full flex-col items-center gap-3 pt-3 text-ink-2 hover:bg-raised hover:text-ink"
        >
          <Expand className="size-4" aria-hidden />
          <Icon className="size-5" aria-hidden />
          {pendingCount > 0 && (
            <span className="min-w-5 rounded-sm bg-amber px-1 text-center font-mono text-xs font-medium text-on-amber motion-safe:animate-pulse">
              {pendingCount}
            </span>
          )}
        </button>
      )}

      {/* Open panel: fixed inner width so content doesn't reflow while the rail animates */}
      {open && (
        <div className="flex h-full flex-col" style={{ width: 'var(--ow-rail-width)' }}>
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
            <Icon className="size-4 text-ink-2" aria-hidden />
            <h2 className="text-md font-medium text-ink">{title}</h2>
            {pendingCount > 0 && (
              <span className="rounded-sm bg-amber-wash px-1.5 font-mono text-xs text-amber">{pendingCount} pending</span>
            )}
            <button
              type="button"
              onClick={onToggle}
              aria-expanded
              aria-label={`Collapse ${title}`}
              className="ml-auto grid size-7 place-items-center rounded-md text-ink-2 hover:bg-raised hover:text-ink"
            >
              <Collapse className="size-4" aria-hidden />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {children ?? <p className="mt-2 max-w-[32ch] text-base text-ink-3">{empty}</p>}
          </div>
        </div>
      )}
    </aside>
  )
}
