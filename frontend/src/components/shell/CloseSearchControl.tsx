import { useEffect, useRef, useState } from 'react'
import { FileText, Flag, Loader2, MapPinCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { closedOutcome } from '@/lib/close'
import { useStore } from '@/store'
import { useCloseSearch } from './useCloseSearch'

/**
 * The status bar's "Close search": the ONE action that ends a search. It opens a small choice with two explicit
 * buttons and nothing pre-selected, so "found" can never be sent by default. Once the stream shows the search is
 * closed (a `search_closed` log entry) it becomes the outcome and a "View report" button.
 */
export function CloseSearchControl() {
  const hasCase = useStore((s) => s.caseProfile !== null)
  const outcome = useStore((s) => closedOutcome(s.log))
  const closing = useStore((s) => s.closing)
  const setPanel = useStore((s) => s.setPanel)
  const reportOpen = useStore((s) => s.ui.panels.report)
  const close = useCloseSearch()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!hasCase) return null

  if (outcome) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-sm bg-amber-wash px-2 py-0.5 text-sm font-medium text-amber" role="status">
          {outcome === 'located' ? 'Search closed: subject located' : 'Search closed: not located'}
        </span>
        <Button variant="secondary" size="sm" onClick={() => setPanel('report', !reportOpen)}>
          <FileText data-icon="inline-start" />
          View report
        </Button>
      </div>
    )
  }

  const choose = async (found: boolean) => {
    if (await close(found, note)) { setOpen(false); setNote('') }
  }

  return (
    <div ref={root} className="relative">
      <Button variant="secondary" size="sm" aria-expanded={open} aria-haspopup="dialog" disabled={closing} onClick={() => setOpen((o) => !o)}>
        {closing ? <Loader2 data-icon="inline-start" className="motion-safe:animate-spin" /> : <Flag data-icon="inline-start" />}
        {closing ? 'Closing…' : 'Close search'}
      </Button>
      {open && (
        <div role="dialog" aria-label="Close the search" className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-80 rounded-lg border border-line-strong bg-panel p-3 shadow-panel">
          <h2 className="text-md font-medium text-ink">How did this search end?</h2>
          <p className="mt-0.5 text-sm text-ink-3">This ends the search and opens the report. Only you can say the subject was located.</p>
          <div className="mt-3 flex flex-col gap-1.5">
            <Button disabled={closing} onClick={() => void choose(true)}>
              <MapPinCheck data-icon="inline-start" />
              Subject located
            </Button>
            <Button variant="secondary" disabled={closing} onClick={() => void choose(false)}>
              Close without locating
            </Button>
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            aria-label="Optional note"
            placeholder="Optional note for the record"
            className="mt-2 h-8 w-full rounded-md border border-line-strong bg-ground px-2.5 text-md text-ink placeholder:text-ink-3 focus-visible:border-amber focus-visible:outline-none"
          />
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
    </div>
  )
}
