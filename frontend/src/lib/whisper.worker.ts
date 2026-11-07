// Runs Whisper (speech to text) off the main thread, in the browser. No server, no key, audio never leaves the machine.
// The model (~100 MB) downloads once from Hugging Face and is cached by the browser.
import { env, pipeline } from '@huggingface/transformers'

env.allowLocalModels = false

const MODEL = 'onnx-community/whisper-base.en'
type Transcriber = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>
let transcriber: Promise<Transcriber> | null = null

function load(): Promise<Transcriber> {
  transcriber ??= (async () => {
    const progress_callback = (p: { status: string; progress?: number }) => {
      if (p.status === 'progress' && typeof p.progress === 'number') self.postMessage({ type: 'progress', progress: p.progress })
    }
    const hasGpu = 'gpu' in navigator
    try {
      if (!hasGpu) throw new Error('no webgpu')
      return (await pipeline('automatic-speech-recognition', MODEL, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      })) as unknown as Transcriber
    } catch {
      return (await pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: 'q8', progress_callback })) as unknown as Transcriber
    }
  })()
  transcriber.catch(() => { transcriber = null })
  return transcriber
}

self.onmessage = async (e: MessageEvent<{ type: 'load' } | { type: 'transcribe'; id: number; audio: Float32Array }>) => {
  const m = e.data
  try {
    const asr = await load()
    if (m.type === 'load') {
      self.postMessage({ type: 'ready' })
      return
    }
    const out = await asr(m.audio, { chunk_length_s: 30, stride_length_s: 5 })
    const text = (Array.isArray(out) ? out[0]?.text : out.text) ?? ''
    self.postMessage({ type: 'result', id: m.id, text: text.trim() })
  } catch (err) {
    self.postMessage({ type: 'error', id: m.type === 'transcribe' ? m.id : -1, message: err instanceof Error ? err.message : String(err) })
  }
}
