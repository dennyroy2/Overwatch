import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Mic, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { appendSpoken, Dictation, dictationSupported } from '@/lib/dictation'
import { getRecognitionCtor, SpeechInput, speechErrorText } from '@/lib/speech'
import { buildNote, sendTip, TipError } from '@/lib/tips'
import { clockTime, isTypingTarget } from '@/lib/ui'
import { useNow } from '@/lib/useNow'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { ghosts } from '@/stream/ghostBuffer'

type Status = 'idle' | 'sending' | 'sent' | 'error'

/**
 * The tip box. Type or hold the mic, press Enter: the words go to the backend EXACTLY as typed as an officer
 * note (POST /evidence). The screen never adds the card itself (hard rule 3): the box clears, shows "Sent",
 * and the card arrives through the stream. If the send fails the text stays in the box with the reason.
 * There is no parse-as-you-type: the frontend never calls an LLM; the card filling in IS the parsing.
 */
export function CommandBar() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [listening, setListening] = useState(false)
  const [level, setLevel] = useState(0)
  const [busy, setBusy] = useState<string | null>(null) // 'Loading speech model 40%' / 'Transcribing…'
  const inputRef = useRef<HTMLInputElement>(null)
  const speechRef = useRef<SpeechInput | null>(null)
  const sentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const Ctor = useMemo(() => getRecognitionCtor(), [])
  const whisper = useMemo(() => dictationSupported(), [])
  const dictRef = useRef<Dictation | null>(null)
  const textRef = useRef(text)
  useEffect(() => { textRef.current = text }, [text])
  const dict = () => (dictRef.current ??= new Dictation())

  const caseId = useStore((s) => s.caseProfile?.case_id ?? null)
  const live = useStore((s) => s.ui.replay.mode === 'live')
  // The preview time: only subscribed while there is text, so an idle box never re-renders with the stream.
  const simIso = useStore((s) => (text.trim() ? s.ghostMeta.t : null))
  const wallNow = useNow(30_000) // the fallback clock when no case is running
  const previewTime = clockTime(simIso ?? wallNow).slice(0, 5)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      speechRef.current?.abort()
      dictRef.current?.dispose()
      if (sentTimer.current) clearTimeout(sentTimer.current)
    }
  }, [])

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    const tip = text.trim()
    if (!tip || status === 'sending') return
    speechRef.current?.stop()
    if (!caseId) {
      setStatus('error')
      setMessage('Open a case first, then the tip can be sent.')
      return
    }
    setStatus('sending')
    setMessage('')
    try {
      // The moment the tip is about: the simulation's "now" (the sim runs far faster than the wall clock).
      await sendTip(buildNote(caseId, tip, ghosts.simTime || Date.now()))
      setText('')
      setStatus('sent')
      if (sentTimer.current) clearTimeout(sentTimer.current)
      sentTimer.current = setTimeout(() => setStatus('idle'), 2400)
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof TipError ? err.message : 'The tip could not be sent')
    }
  }

  function fail(msg: string) {
    setStatus('error')
    setMessage(msg)
  }

  // Preferred: Whisper in the browser (accurate, private). Fallback: the browser's own recogniser.
  async function startListening() {
    if (listening || busy) return
    setStatus('idle')
    setMessage('')
    if (whisper) {
      const d = dict()
      d.onLevel = setLevel
      d.onProgress = (pct) => setBusy(`Loading speech model ${Math.round(pct)}%`)
      try {
        await d.start()
        setListening(true)
        void d.preload().then(() => setBusy(null), () => {})
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        fail(name === 'NotAllowedError' ? speechErrorText('not-allowed') : speechErrorText('audio-capture'))
      }
      return
    }
    if (!Ctor) return
    speechRef.current ??= new SpeechInput(Ctor)
    setListening(true)
    speechRef.current.start(text, {
      onText: setText,
      onEnd: () => setListening(false),
      onError: (code) => fail(speechErrorText(code)),
    })
  }
  async function stopListening() {
    if (whisper) {
      const d = dictRef.current
      if (!d?.recording) return
      setListening(false)
      setBusy((b) => b ?? 'Transcribing…')
      try {
        const spoken = await d.stop()
        setBusy('Transcribing…')
        if (spoken) setText(appendSpoken(textRef.current, spoken))
        else fail(d.lastPeak < 0.003 ? 'The microphone is silent. Check the input device in System Settings, then try again.' : speechErrorText('no-speech'))
      } catch {
        fail('Could not transcribe that. Type the tip instead.')
      } finally {
        setBusy(null)
      }
      return
    }
    speechRef.current?.stop()
  }

  const trimmed = text.trim()
  // What the right-hand end of the box says, most important first.
  let note: { text: string; tone: 'amber' | 'danger' | 'success' | 'muted' } | null = null
  if (listening) note = { text: whisper ? `Listening ${'▮'.repeat(Math.round(level * 8)).padEnd(8, '▯')}` : 'Listening… release to stop', tone: 'amber' }
  else if (busy) note = { text: busy, tone: 'amber' }
  else if (status === 'error') note = { text: message, tone: 'danger' }
  else if (status === 'sent') note = { text: live ? 'Sent' : 'Sent · shows when you go live', tone: 'success' }
  else if (trimmed) note = { text: `Officer note · ${previewTime}`, tone: 'muted' }

  return (
    <form
      className="pointer-events-auto absolute inset-x-3 bottom-3 z-20 flex h-14 items-center gap-2 rounded-lg border border-line bg-panel px-3 shadow-panel"
      onSubmit={submit}
    >
      <Button
        type="button"
        variant="secondary"
        size="icon"
        disabled={!whisper && !Ctor}
        aria-label={whisper || Ctor ? 'Hold to speak' : 'Speech is not available in this browser'}
        aria-pressed={listening}
        title={whisper || Ctor ? 'Hold to speak' : 'Speech needs Chrome. Type the tip instead.'}
        className={cn(listening && 'border border-amber text-amber')}
        onPointerDown={(e) => {
          e.preventDefault()
          // Keep receiving the release even if the pointer drifts off the button. Not every pointer can be captured.
          try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* the release still arrives */ }
          startListening()
        }}
        onPointerUp={stopListening}
        onPointerCancel={stopListening}
        onKeyDown={(e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startListening() } }}
        onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stopListening() } }}
      >
        <Mic />
      </Button>

      <div className="relative min-w-0 flex-1">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); if (status === 'error' || status === 'sent') { setStatus('idle'); setMessage('') } }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') inputRef.current?.blur()
            // Handle Enter ourselves: browsers skip implicit form submission when the default button is disabled
            // (no case yet), which would leave the officer with no explanation.
            else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void submit() }
          }}
          onFocus={() => { if (whisper) void dict().preload().catch(() => {}) }}
          aria-label="Add a tip to the case"
          aria-invalid={status === 'error'}
          autoComplete="off"
          maxLength={2000}
          placeholder={caseId ? 'Type what you know, or hold the mic. Press Enter to send.' : 'Type a tip. Open a case to send it.'}
          className={cn(
            'h-9 w-full min-w-0 rounded-md border bg-ground pl-3 pr-52 text-md text-ink placeholder:text-ink-3',
            status === 'error' ? 'border-danger' : 'border-line-strong',
          )}
        />
        {note && (
          <span
            className={cn(
              'pointer-events-none absolute right-3 top-1/2 max-w-[13rem] -translate-y-1/2 truncate text-xs',
              note.tone === 'amber' && 'text-amber',
              note.tone === 'danger' && 'text-danger',
              note.tone === 'success' && 'text-success',
              note.tone === 'muted' && 'font-mono text-ink-3',
            )}
            title={note.tone === 'muted' ? 'Sent exactly as typed. The AI turns it into a structured card.' : note.text}
          >
            {note.text}
          </span>
        )}
        <span className="sr-only" role="status">{status === 'sent' ? 'Tip sent' : status === 'error' ? message : ''}</span>
      </div>

      <Button
        type="submit"
        disabled={!trimmed || !caseId || status === 'sending'}
        title={!caseId ? 'Open a case to send tips' : undefined}
      >
        {status === 'sent' ? <Check data-icon="inline-start" /> : <SendHorizontal data-icon="inline-start" />}
        {status === 'sending' ? 'Sending' : status === 'sent' ? 'Sent' : 'Add tip'}
      </Button>
    </form>
  )
}
