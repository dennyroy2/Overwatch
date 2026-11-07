import { describe, expect, it } from 'vitest'
import { SpeechInput, assemble, getRecognitionCtor, speechErrorText, type RecognitionEventLike, type RecognitionLike, type RecognitionResultLike } from './speech'

const result = (transcript: string, isFinal = true): RecognitionResultLike => ({ isFinal, length: 1, 0: { transcript } })

class FakeRecognition implements RecognitionLike {
  static last: FakeRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  onresult: ((e: RecognitionEventLike) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  stopped = false
  constructor() { FakeRecognition.last = this }
  start() { this.started = true }
  stop() { this.stopped = true; this.onend?.() }
  abort() { this.stopped = true }
  say(...rs: RecognitionResultLike[]) { this.onresult?.({ resultIndex: 0, results: rs }) }
}

describe('assemble', () => {
  it('puts what was heard after the existing text with single spaces', () => {
    expect(assemble('', [result('bus driver saw a woman', false)])).toBe('bus driver saw a woman')
    expect(assemble('Tip:', [result(' bus driver'), result(' saw her', false)])).toBe('Tip: bus driver saw her')
    expect(assemble('  hello  ', [])).toBe('hello')
  })
})

describe('getRecognitionCtor', () => {
  it('finds the standard or the webkit name, else null (the mic stays off)', () => {
    expect(getRecognitionCtor({})).toBeNull()
    expect(getRecognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
    expect(getRecognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
  })
})

describe('SpeechInput', () => {
  it('listens in Canadian English with interim words, streams the text into the box, and keeps it when released', () => {
    const texts: string[] = []
    let ended = 0
    const s = new SpeechInput(FakeRecognition)
    s.start('', { onText: (t) => texts.push(t), onEnd: () => { ended += 1 }, onError: () => {} })
    const rec = FakeRecognition.last as FakeRecognition
    expect(rec.started).toBe(true)
    expect(rec.lang).toBe('en-CA')
    expect(rec.interimResults).toBe(true)
    expect(s.listening).toBe(true)
    rec.say(result('bus driver', false))
    rec.say(result('bus driver saw a woman', false))
    rec.say(result('bus driver saw a woman in a blue jacket', true))
    expect(texts).toEqual(['bus driver', 'bus driver saw a woman', 'bus driver saw a woman in a blue jacket'])
    s.stop()
    expect(ended).toBe(1)
    expect(s.listening).toBe(false)
  })

  it('appends to text that was already typed', () => {
    const texts: string[] = []
    const s = new SpeechInput(FakeRecognition)
    s.start('At the bridge,', { onText: (t) => texts.push(t), onEnd: () => {}, onError: () => {} })
    ;(FakeRecognition.last as FakeRecognition).say(result('she was wearing blue'))
    expect(texts[0]).toBe('At the bridge, she was wearing blue')
  })

  it('reports errors, and ignores a second start while listening', () => {
    const errors: string[] = []
    const s = new SpeechInput(FakeRecognition)
    s.start('', { onText: () => {}, onEnd: () => {}, onError: (c) => errors.push(c) })
    const first = FakeRecognition.last
    s.start('', { onText: () => {}, onEnd: () => {}, onError: () => {} })
    expect(FakeRecognition.last).toBe(first) // no second recogniser
    ;(first as FakeRecognition).onerror?.({ error: 'not-allowed' })
    expect(errors).toEqual(['not-allowed'])
  })

  it('turns a start failure into a clear error', () => {
    class Throws extends FakeRecognition { start(): void { throw new Error('already started') } }
    const errors: string[] = []
    let ended = 0
    const s = new SpeechInput(Throws)
    s.start('', { onText: () => {}, onEnd: () => { ended += 1 }, onError: (c) => errors.push(c) })
    expect(errors).toEqual(['audio-capture'])
    expect(ended).toBe(1)
    expect(s.listening).toBe(false)
  })
})

describe('speechErrorText', () => {
  it('explains the common failures and always offers typing', () => {
    expect(speechErrorText('not-allowed')).toMatch(/blocked/)
    expect(speechErrorText('weird-new-code')).toMatch(/type the tip/i)
  })
})
