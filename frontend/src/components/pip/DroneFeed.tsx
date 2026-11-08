import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drone, Pause, Play, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { areaCentre } from '@/lib/tasking'
import {
  boxLabel, containRect, detectionsAt, frameAt, loadManifest, loadSidecar, matchEvidence, pickClip,
  type ClipEntry, type FootageDetection, type Sidecar,
} from '@/lib/footage'
import { useStore } from '@/store'
import { paintBoxes } from './paint'

type Footage =
  | { status: 'loading' }
  | { status: 'none' } // no manifest, or no clip in it
  | { status: 'ready'; clip: ClipEntry; doc: Sidecar | null }

/**
 * The drone feed (step 34). It plays the clip nearest the approved request's target area and draws the detections
 * perception found, synced to the video time. The STREAM drives the moment, not the video: when a drone evidence
 * item arrives, the feed jumps to that detection, holds, and highlights it, so the footage can never disagree with
 * the evidence card. Nothing here creates evidence; it only shows the sidecar's boxes.
 */
export function DroneFeed({ requestId, onClose }: { requestId: string | null; onClose: () => void }) {
  const request = useStore((s) => (requestId ? s.requests.byId[requestId] : undefined))
  const target = useMemo(() => (request ? areaCentre(request) : null), [request])
  const selectEvidence = useStore((s) => s.selectEvidence)

  const [footage, setFootage] = useState<Footage>({ status: 'loading' })
  const [videoMissing, setVideoMissing] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [ended, setEnded] = useState(false)
  const [held, setHeld] = useState<FootageDetection | null>(null)
  const [alt, setAlt] = useState<number | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const handled = useRef(new Set<string>())
  const doc = footage.status === 'ready' ? footage.doc : null

  // Find the clip: the manifest says what exists, the request's place says which one.
  useEffect(() => {
    let alive = true
    void (async () => {
      const clips = await loadManifest()
      const clip = pickClip(clips, target)
      if (!alive) return
      if (!clip) return setFootage({ status: 'none' })
      const sidecar = await loadSidecar(clip)
      if (alive) setFootage({ status: 'ready', clip, doc: sidecar })
    })()
    return () => { alive = false }
  }, [target])

  // The stream drives the moment: a drone clue arriving (or already here) holds the feed on its detection.
  useEffect(() => {
    if (!doc) return
    handled.current = new Set()
    const check = () => {
      const s = useStore.getState()
      for (const id of s.evidence.order) {
        if (handled.current.has(id)) continue
        const ev = s.evidence.byId[id]
        if (!ev || ev.source !== 'drone_ai') continue
        handled.current.add(id)
        const d = matchEvidence(doc, ev)
        if (d) setHeld(d)
      }
    }
    check()
    return useStore.subscribe(check)
  }, [doc])

  // Holding: jump to the flagged frame and stop there.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !held) return
    const go = () => {
      v.currentTime = held.time_s
      v.pause()
    }
    const stay = () => v.pause()
    v.addEventListener('seeked', stay, { once: true })
    if (v.readyState >= 1) go()
    else v.addEventListener('loadedmetadata', go, { once: true })
    return () => {
      v.removeEventListener('seeked', stay)
      v.removeEventListener('loadedmetadata', go)
    }
  }, [held])

  // Draw the boxes for the video's current moment. Only repaint when the sampled frame, the hold or the size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const v = videoRef.current
    if (!canvas || !v || videoMissing) return
    let raf = 0
    let key = ''
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const f = doc ? frameAt(doc, v.currentTime) : null
      const next = `${f?.index ?? -1}|${held ? held.frame : '-'}|${rect.width}x${rect.height}|${dpr}`
      if (next === key) return
      key = next
      setAlt((a) => (a === (f?.drone.alt_m ?? null) ? a : (f?.drone.alt_m ?? null)))
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const picture = containRect(rect.width, rect.height, v.videoWidth || doc?.width || 16, v.videoHeight || doc?.height || 9)
      paintBoxes({ ctx, width: rect.width, height: rect.height, picture, detections: doc && f ? detectionsAt(doc, v.currentTime) : [], held })
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [doc, held, videoMissing])

  const resume = useCallback(() => {
    setHeld(null)
    setEnded(false)
    void videoRef.current?.play().catch(() => setPlaying(false))
  }, [])
  const replay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = 0
    setHeld(null)
    setEnded(false)
    void v.play().catch(() => setPlaying(false))
  }, [])
  const toggle = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (held) resume()
    else if (v.paused) void v.play().catch(() => setPlaying(false))
    else v.pause()
  }, [held, resume])

  const asset = (footage.status === 'ready' && (doc?.asset ?? footage.clip.asset)) || 'Drone'
  const label = held ? boxLabel(held) : null
  const noVideo = footage.status !== 'ready' || videoMissing
  const state = noVideo ? 'NO VIDEO' : held ? 'HELD' : playing ? 'LIVE' : ended ? 'ENDED' : 'PAUSED'
  const dot = noVideo ? 'bg-ink-3' : held ? 'bg-amber' : playing ? 'bg-danger' : 'bg-ink-3'

  return (
    <section
      aria-label="Drone feed"
      className="pointer-events-auto absolute bottom-[var(--ow-dock)] right-[calc(var(--ow-rail-width)+1.5rem)] z-10 w-[28rem] overflow-hidden rounded-lg border border-line bg-panel shadow-panel"
    >
      <div className="flex h-9 items-center gap-2 border-b border-line pl-3 pr-1">
        <Drone className="size-4 shrink-0 text-ink-2" aria-hidden />
        <span className="flex min-w-0 items-center gap-1.5 font-mono text-sm text-ink-2" data-testid="feed-header">
          <span className={`inline-block size-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
          <span className="truncate">{state} · {asset}{!noVideo && alt !== null ? ` · alt ${Math.round(alt)} m` : ''}</span>
        </span>
        <span className="ml-auto flex items-center">
          {footage.status === 'ready' && !videoMissing && (
            <Button variant="ghost" size="icon-sm" onClick={ended ? replay : toggle} aria-label={ended ? 'Replay the feed' : playing ? 'Pause the feed' : 'Play the feed'}>
              {ended ? <RotateCcw /> : playing ? <Pause /> : <Play />}
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close the drone feed"><X /></Button>
        </span>
      </div>

      <div className="relative aspect-video bg-ground">
        {footage.status === 'ready' && !videoMissing && (
          <>
            <video
              ref={videoRef}
              src={footage.clip.video}
              className="absolute inset-0 size-full object-contain"
              autoPlay
              muted
              playsInline
              preload="auto"
              onPlay={() => { setPlaying(true); setEnded(false) }}
              onPause={() => setPlaying(false)}
              onEnded={() => { setPlaying(false); setEnded(true) }}
              onError={() => setVideoMissing(true)}
            />
            <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 size-full" aria-hidden />
          </>
        )}
        {footage.status === 'loading' && <Notice>Loading the drone feed…</Notice>}
        {footage.status === 'none' && <Notice>No drone footage for this area.</Notice>}
        {footage.status === 'ready' && videoMissing && (
          <Notice>
            The drone video isn't on this machine. Get {footage.clip.id}.mp4 from the team Drive and put it in frontend/public/footage/.
          </Notice>
        )}
      </div>

      {held && (
        <div className="flex items-center gap-2 border-t border-line px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-ai" title={label ?? undefined}>
            Flagged: {label ?? 'a detection'}
          </span>
          {held.evidence_id && (
            <Button variant="secondary" size="sm" onClick={() => selectEvidence(held.evidence_id)}>Show card</Button>
          )}
          <Button variant="secondary" size="sm" onClick={resume}>Resume</Button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{held ? `Drone feed held on ${label ?? 'a detection'}.` : ''}</p>
    </section>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <p className="max-w-[34ch] text-center text-base text-ink-3">{children}</p>
    </div>
  )
}
