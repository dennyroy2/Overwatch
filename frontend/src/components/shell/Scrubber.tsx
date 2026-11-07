import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { selectDisplayedClusters, useStore } from '@/store'
import { history } from '@/stream/history'
import { formatDuration, isTypingTarget } from '@/lib/ui'
import { playback } from '@/stream/playback'

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/**
 * The time bar (like the bottom of a video): pause the view, drag back through the simulation, play from
 * there, or jump to live. The search keeps running on the server while the view is paused; everything that
 * arrives is still recorded (stream/history.ts), so the right-hand end keeps growing.
 */
export function Scrubber() {
  const mode = useStore((s) => s.ui.replay.mode)
  const simMs = useStore((s) => {
    const rv = s.ui.replay.mode !== 'live' ? s.replayView : null
    if (rv) return rv.simTime
    return s.ghostMeta.t ? Date.parse(s.ghostMeta.t) : null
  })
  // The clusters are not read here; subscribing keeps the bar honest if replay data changes.
  useStore(selectDisplayedClusters)
  // "Now" is state, refreshed at 10 Hz: position changes many times a second, so it is polled here rather
  // than pushed through the store, and render stays free of impure calls.
  const [now, setNow] = useState(() => performance.now())
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setNow(performance.now()), 100)
    return () => clearInterval(id)
  }, [])

  // Space pauses and plays (not while typing, and not when a button or the slider has focus: they handle it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'BUTTON' || (e.target as HTMLElement | null)?.getAttribute?.('role') === 'slider') return
      e.preventDefault()
      playback.toggle(performance.now())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const has = !history.isEmpty
  const start = history.startT
  const live = history.liveT(now)
  const pos = playback.isLive ? live : Math.min(playback.T, live)
  const span = Math.max(1, live - start)
  const frac = has ? clamp01((pos - start) / span) : 0 // nothing recorded: an empty, disabled bar
  const behind = playback.behindMs(now)
  const clock = simMs ? new Date(simMs).toLocaleTimeString('en-CA', { hour12: false }) : '--:--:--'

  const seekFromPointer = (clientX: number) => {
    const el = trackRef.current
    if (!el || !has) return
    const r = el.getBoundingClientRect()
    const f = clamp01((clientX - r.left) / r.width)
    const n = performance.now()
    playback.seek(history.startT + f * (history.liveT(n) - history.startT), n)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!has) return
    const n = performance.now()
    const step = e.shiftKey ? 30_000 : 5_000
    const at = playback.isLive ? history.liveT(n) : playback.T
    if (e.key === 'ArrowLeft') { e.preventDefault(); playback.seek(at - step, n) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); playback.seek(at + step, n) }
    else if (e.key === 'Home') { e.preventDefault(); playback.seek(history.startT, n) }
    else if (e.key === 'End') { e.preventDefault(); playback.goLive() }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); playback.toggle(n) }
  }

  const valueText = `Simulation time ${clock}${behind > 1000 ? `, ${formatDuration(behind)} behind live` : ', live'}`

  return (
    <div
      role="group"
      aria-label="Simulation time"
      className="pointer-events-auto absolute inset-x-3 bottom-[4.5rem] z-20 flex h-10 items-center gap-3 rounded-lg border border-line bg-panel px-3 shadow-panel"
    >
      <Button
        variant="ghost"
        size="icon"
        disabled={!has}
        onClick={() => playback.toggle(performance.now())}
        aria-label={mode === 'paused' ? 'Play from here' : 'Pause the view'}
        title={mode === 'paused' ? 'Play from here' : 'Pause the view (the search keeps running)'}
      >
        {mode === 'paused' ? <Play /> : <Pause />}
      </Button>

      <span className="w-[6.5rem] shrink-0 font-mono text-sm text-ink-2" data-testid="scrub-time">
        {has ? `${formatDuration(pos - start)} / ${formatDuration(live - start)}` : '0:00 / 0:00'}
      </span>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={has ? 0 : -1}
        aria-label="Simulation time"
        aria-valuemin={0}
        aria-valuemax={Math.round(span / 1000)}
        aria-valuenow={Math.round((pos - start) / 1000)}
        aria-valuetext={valueText}
        aria-disabled={!has}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          if (!has) return
          e.currentTarget.setPointerCapture(e.pointerId)
          playback.scrubbing = true
          seekFromPointer(e.clientX)
        }}
        onPointerMove={(e) => { if (playback.scrubbing) seekFromPointer(e.clientX) }}
        onPointerUp={(e) => {
          if (!playback.scrubbing) return
          playback.scrubbing = false
          seekFromPointer(e.clientX) // released at the live end: go live
        }}
        onPointerCancel={() => { playback.scrubbing = false }}
        className={cn('group relative h-6 flex-1 touch-none outline-none', has ? 'cursor-pointer' : 'cursor-default opacity-50')}
      >
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-control" />
        <div className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-sm bg-amber-dim" style={{ width: `${frac * 100}%` }} />
        {has &&
          history.events.map((e, i) => (
            <span
              key={i}
              aria-hidden
              className={cn('absolute top-0.5 h-2 w-px', e.kind === 'evidence' ? 'bg-warm' : 'bg-amber')}
              style={{ left: `${clamp01((e.t - start) / span) * 100}%` }}
            />
          ))}
        <div
          className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ground bg-amber group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-amber"
          style={{ left: `${frac * 100}%` }}
        />
      </div>

      <span className="w-[4.5rem] shrink-0 text-right font-mono text-sm text-ink" data-testid="scrub-clock">{clock}</span>

      {playback.isLive ? (
        <span className="flex w-[6rem] shrink-0 items-center justify-end gap-1.5 text-sm text-success" role="status">
          <span className="size-2 rounded-full bg-success" aria-hidden />
          {has ? 'Live' : 'No search yet'}
        </span>
      ) : (
        <Button variant="secondary" size="sm" className="w-[6rem] shrink-0" onClick={() => playback.goLive()} title="Jump back to the live view">
          <span className="text-amber">Go live</span>
          <span className="font-mono text-xs text-ink-2">-{formatDuration(behind)}</span>
        </Button>
      )}
    </div>
  )
}
