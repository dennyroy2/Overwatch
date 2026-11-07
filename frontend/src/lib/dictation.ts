// Dictation (step 20): hold the mic, speak, release; Whisper (running in the browser) turns the recording into
// text. Far more accurate than the browser's built-in recogniser, and nothing is sent to a third party.
// Not live: the words appear when the mic is released (a second or two for a short tip).

const SAMPLE_RATE = 16_000 // Whisper's input rate

export const dictationSupported = (): boolean =>
  typeof Worker !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** Loudest sample, 0..1. */
export function peakOf(a: Float32Array): number {
  let m = 0
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v }
  return m
}

/** Scale quiet recordings up to a healthy level (never more than 40x, so silence stays silence). */
export function normalize(a: Float32Array, target = 0.9): Float32Array {
  const p = peakOf(a)
  if (p < 0.003) return a
  const g = Math.min(target / p, 40)
  if (g <= 1.05) return a
  for (let i = 0; i < a.length; i++) a[i] *= g
  return a
}

/** Mono 16 kHz samples for Whisper from a recorded blob. */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE })
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    return buf.getChannelData(0).slice()
  } finally {
    void ctx.close()
  }
}

type Pending = { resolve: (t: string) => void; reject: (e: Error) => void }

export class Dictation {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, Pending>()
  private readyWaiters: { resolve: () => void; reject: (e: Error) => void }[] = []
  private ready = false
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  onProgress: ((pct: number) => void) | null = null
  /** Live microphone level 0..1 while recording. */
  onLevel: ((level: number) => void) | null = null
  /** Loudest level of the last recording, 0..1 (0 means the microphone gave silence). */
  lastPeak = 0
  private meter: { ctx: AudioContext; raf: number } | null = null
  private maxPct = 0 // several files download in turn; only ever show the furthest point

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ type: string; id?: number; text?: string; message?: string; progress?: number }>) => {
      const m = e.data
      if (m.type === 'progress') {
        this.maxPct = Math.max(this.maxPct, m.progress ?? 0)
        this.onProgress?.(this.maxPct)
      }
      else if (m.type === 'ready') {
        this.ready = true
        this.readyWaiters.splice(0).forEach((r) => r.resolve())
      } else if (m.type === 'result') {
        this.pending.get(m.id ?? -1)?.resolve(m.text ?? '')
        this.pending.delete(m.id ?? -1)
      } else if (m.type === 'error') {
        const err = new Error(m.message ?? 'Speech model failed')
        if (m.id !== undefined && m.id >= 0) { this.pending.get(m.id)?.reject(err); this.pending.delete(m.id) }
        else this.readyWaiters.splice(0).forEach((r) => r.reject(err))
      }
    }
    this.worker = w
    return w
  }

  /** Start downloading and warming the model (safe to call many times). */
  preload(): Promise<void> {
    if (this.ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      this.readyWaiters.push({ resolve, reject })
      if (this.readyWaiters.length === 1) this.ensureWorker().postMessage({ type: 'load' })
    })
  }

  get recording(): boolean {
    return this.recorder !== null
  }

  /** Open the microphone and record until `stop`. Throws with the browser's error name (NotAllowedError ...). */
  async start(): Promise<void> {
    if (this.recorder) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } })
    this.chunks = []
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(this.stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    const tick = () => {
      an.getFloatTimeDomainData(buf)
      this.onLevel?.(Math.min(1, peakOf(buf) * 3))
      if (this.meter) this.meter.raf = requestAnimationFrame(tick)
    }
    this.meter = { ctx, raf: requestAnimationFrame(tick) }
    const rec = new MediaRecorder(this.stream)
    rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data) }
    this.recorder = rec
    rec.start()
  }

  /** Stop recording and return the transcript ('' when nothing was heard). */
  async stop(): Promise<string> {
    const rec = this.recorder
    if (!rec) return ''
    this.recorder = null
    const done = new Promise<void>((resolve) => { rec.onstop = () => resolve() })
    rec.stop()
    await done
    this.stopMeter()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    const blob = new Blob(this.chunks, { type: rec.mimeType })
    this.chunks = []
    if (blob.size < 1500) return '' // a tap, not speech
    const audio = await decodeToMono16k(blob)
    this.lastPeak = peakOf(audio)
    if (this.lastPeak < 0.003) return '' // the microphone gave silence
    normalize(audio)
    if (audio.length < SAMPLE_RATE * 0.4) return ''
    await this.preload()
    const id = this.nextId++
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ensureWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer])
    })
  }

  private stopMeter(): void {
    if (!this.meter) return
    cancelAnimationFrame(this.meter.raf)
    void this.meter.ctx.close()
    this.meter = null
    this.onLevel?.(0)
  }

  /** Release the microphone and drop the worker. */
  dispose(): void {
    this.stopMeter()
    this.recorder?.stream.getTracks().forEach((t) => t.stop())
    this.stream?.getTracks().forEach((t) => t.stop())
    this.recorder = null
    this.worker?.terminate()
    this.worker = null
  }
}

/** Existing text plus what was said, joined with one space. */
export const appendSpoken = (base: string, spoken: string): string => [base.trim(), spoken.trim()].filter(Boolean).join(' ')
