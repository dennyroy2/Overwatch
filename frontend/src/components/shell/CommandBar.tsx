import { Mic, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Layout and empty state only. Typing, speech and POST /evidence are wired in step 20. */
export function CommandBar({ disabled = true }: { disabled?: boolean }) {
  return (
    <form
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 flex h-14 items-center gap-2 rounded-lg border border-line bg-panel px-3 shadow-panel"
      onSubmit={(e) => e.preventDefault()}
    >
      <Button type="button" variant="secondary" size="icon" disabled={disabled} aria-label="Hold to speak">
        <Mic />
      </Button>
      <input
        disabled={disabled}
        aria-label="Add a tip to the case"
        placeholder={disabled ? 'Open a case to add tips' : 'Type what you know, or hold the mic to speak'}
        className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-ground px-3 text-md text-ink placeholder:text-ink-3 disabled:opacity-60"
      />
      <Button type="submit" disabled={disabled}>
        <SendHorizontal data-icon="inline-start" />
        Add tip
      </Button>
    </form>
  )
}
