import { useEffect, useRef, useState } from 'react'
import { Mic, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import { isTypingTarget } from '@/lib/ui'

/**
 * The tip box. It takes input and shows what is typed. Sending (POST /evidence) and speech arrive in
 * step 20, so for now the text just stays in the box and "Add tip" is off. Press / anywhere to jump here.
 */
export function CommandBar() {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const caseOpen = useStore((s) => s.caseProfile !== null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <form
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 flex h-14 items-center gap-2 rounded-lg border border-line bg-panel px-3 shadow-panel"
      onSubmit={(e) => e.preventDefault()}
    >
      <Button type="button" variant="secondary" size="icon" disabled aria-label="Hold to speak (coming soon)" title="Speech arrives in a later step">
        <Mic />
      </Button>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') inputRef.current?.blur() }}
        aria-label="Add a tip to the case"
        autoComplete="off"
        placeholder={caseOpen ? 'Type what you know. Press / to jump here.' : 'Type a tip. You can send it once a case is open.'}
        className="h-9 min-w-0 flex-1 rounded-md border border-line-strong bg-ground px-3 text-md text-ink placeholder:text-ink-3"
      />
      <Button type="submit" disabled title="Sending tips arrives in a later step">
        <SendHorizontal data-icon="inline-start" />
        Add tip
      </Button>
    </form>
  )
}
