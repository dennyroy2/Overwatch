import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Loader2, MapPinCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { closedOutcome, foundKey } from '@/lib/close'
import { useStore } from '@/store'
import { useCloseSearch } from './useCloseSearch'

/**
 * "Possible match located. Awaiting officer confirmation." The AI never declares anyone found (hard rule 8): this
 * banner only asks. "Confirm subject located" is the shortcut for Close search with found: true (same POST, then
 * the report). "Not a match" hides the banner on this screen only: the contract cannot record a dismissal yet
 * (ask #17), and the map marker stays so the sighting is not lost.
 */
export function FoundBanner() {
  const reduced = useReducedMotion()
  const found = useStore((s) => s.found)
  const dismissed = useStore((s) => s.foundDismissed)
  const closed = useStore((s) => closedOutcome(s.log) !== null)
  const closing = useStore((s) => s.closing)
  const dismiss = useStore((s) => s.dismissFound)
  const close = useCloseSearch()
  const key = foundKey(found)
  const visible = !!found && key !== dismissed && !closed

  return (
    <AnimatePresence>
      {visible && found && (
        <motion.section
          key={key}
          role="alert"
          aria-label="Possible match located"
          initial={reduced ? false : { opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduced ? undefined : { opacity: 0, y: -8 }}
          transition={{ duration: reduced ? 0 : 0.28 }}
          className="pointer-events-auto absolute left-1/2 top-[4.25rem] z-40 w-[34rem] max-w-[calc(100%-50rem)] min-w-[26rem] -translate-x-1/2 rounded-lg border border-amber bg-panel p-3 shadow-panel"
        >
          <p className="flex gap-2 text-md font-medium leading-snug text-ai">
            <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{found.note}</span>
          </p>
          <div className="mt-2.5 flex gap-2">
            <Button size="sm" disabled={closing} onClick={() => void close(true)}>
              {closing ? <Loader2 data-icon="inline-start" className="motion-safe:animate-spin" /> : <MapPinCheck data-icon="inline-start" />}
              {closing ? 'Closing…' : 'Confirm subject located'}
            </Button>
            <Button size="sm" variant="secondary" disabled={closing} onClick={() => dismiss(key)}>Not a match</Button>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  )
}
