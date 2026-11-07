// Hold-to-speak (step 20) on the browser's Web Speech API. Chrome only, and Chrome sends the audio to a
// Google service: fine for the fictional demo, a real consideration for a real deployment. Where the API
// is missing the mic stays off and the officer types. Wrapped so it can be tested with a fake recogniser.

export interface RecognitionResultLike {
  isFinal: boolean
  length: number
  [index: number]: { transcript: string }
}
export interface RecognitionEventLike {
  resultIndex: number
  results: ArrayLike<RecognitionResultLike>
}
export interface RecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: RecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognitionCtor = new () => RecognitionLike

/** The browser's recogniser, or null when it has none (Firefox, Safari, an old Chrome). */
export function getRecognitionCtor(w: object = window): RecognitionCtor | null {
  const g = w as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null
}

/** The existing text, then everything heard so far (final and interim words), with single spaces between. */
export function assemble(base: string, results: ArrayLike<RecognitionResultLike>): string {
  let heard = ''
  for (let i = 0; i < results.length; i++) heard += results[i][0].transcript
  const parts = [base.trim(), heard.trim()].filter(Boolean)
  return parts.join(' ')
}

/** Plain-language reasons, for the codes the API reports. */
export const SPEECH_ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow it in the browser, or type the tip.',
  'service-not-allowed': 'Speech recognition is not allowed here. Type the tip instead.',
  'no-speech': 'No speech heard. Hold the mic and speak, or type the tip.',
  'audio-capture': 'No built-in microphone found. Type the tip instead.',
  network: 'Speech recognition needs the network. Type the tip instead.',
}
export const speechErrorText = (code: string): string => SPEECH_ERRORS[code] ?? 'Speech recognition stopped. Type the tip instead.'

export interface SpeechHandlers {
  /** The whole text so far (base + words heard), including interim words. */
  onText: (text: string) => void
  /** Recognition finished, normally or after an error. */
  onEnd: () => void
  onError: (code: string) => void
}

export class SpeechInput {
  private rec: RecognitionLike | null = null
  private readonly Ctor: RecognitionCtor
  private readonly lang: string

  constructor(Ctor: RecognitionCtor, lang = 'en-CA') {
    this.Ctor = Ctor
    this.lang = lang
  }

  get listening(): boolean {
    return this.rec !== null
  }

  /** Start listening. Words are appended to `base` as they are heard, interim ones included. */
  start(base: string, h: SpeechHandlers): void {
    if (this.rec) return
    const rec = new this.Ctor()
    rec.lang = this.lang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => h.onText(assemble(base, e.results))
    rec.onerror = (e) => h.onError(e.error)
    rec.onend = () => {
      this.rec = null
      h.onEnd()
    }
    this.rec = rec
    try {
      rec.start()
    } catch {
      this.rec = null
      h.onError('audio-capture')
      h.onEnd()
    }
  }

  /** Stop listening (the words heard so far are kept). */
  stop(): void {
    this.rec?.stop()
  }

  abort(): void {
    const r = this.rec
    this.rec = null
    r?.abort()
  }
}
