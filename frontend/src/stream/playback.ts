// Pause, scrub and replay controller (step 38, built early). Plain TypeScript, no React, no timers: every
// method takes the current time, so it is testable with fake clocks.
//
// Modes:
//   live     the screen shows the newest data (default)
//   paused   the screen is frozen at history time T (a static picture you can study)
//   playing  replaying from T at normal speed; you are `behind live` by the amount shown, until you go live
//
// The backend keeps running while we are paused or behind live (it cannot be paused). Everything arriving is
// still recorded, so the time bar's right-hand end keeps growing.
import { history, type History } from './history'
import type { Cluster } from '@/types'

export type PlaybackMode = 'live' | 'paused' | 'playing'

/** Closer than this to the live edge counts as live. */
const LIVE_EPS_MS = 300

/** What the screen was showing when we paused from live, so the frozen picture is exact. */
export interface LiveCapture {
  /** Drawn positions [lon, lat, elevation] per slot. */
  drawn: Float32Array
  count: number
  /** Newest data frame in ghostBuffer layout (only the weights are read). */
  weights: Float32Array
  simTime: number
  clusters: readonly Cluster[]
  alive: number | null
}

export class Playback {
  mode: PlaybackMode = 'live'
  /** History time shown when not live. */
  T = 0
  /** True while the officer is dragging the thumb (time stands still). */
  scrubbing = false
  private lastNow = 0
  private capture: (() => LiveCapture | null) | null = null
  private listeners = new Set<() => void>()
  private revision = 0

  private readonly history: History

  constructor(history: History) {
    this.history = history
  }

  /** The render loop registers how to read what is on screen right now. */
  setCapture(fn: (() => LiveCapture | null) | null): void {
    this.capture = fn
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    this.revision += 1
    for (const fn of this.listeners) fn()
  }

  /** Bumps whenever the picture to draw may have changed (mode change, seek, or time advancing). */
  get version(): number {
    return this.revision
  }

  get isLive(): boolean {
    return this.mode === 'live'
  }

  /** How far behind the live edge the picture is, ms (0 when live). */
  behindMs(nowMs: number): number {
    return this.mode === 'live' ? 0 : Math.max(0, this.history.liveT(nowMs) - this.T)
  }

  /** Freeze the picture where it is. From live it freezes the exact frame on screen. */
  pause(nowMs: number): void {
    if (this.history.isEmpty) return
    if (this.mode === 'live') {
      const live = this.history.liveT(nowMs)
      const cap = this.capture?.()
      if (cap) this.history.insertSnapshot(live, cap.drawn, cap.count, cap.weights, cap.simTime, cap.clusters, cap.alive)
      this.T = live
    }
    this.mode = 'paused'
    this.lastNow = nowMs
    this.emit()
  }

  /** Resume from the paused point at normal speed (or go live if that point is the live edge). */
  play(nowMs: number): void {
    if (this.mode === 'live' || this.history.isEmpty) return
    if (this.history.liveT(nowMs) - this.T <= LIVE_EPS_MS) return this.goLive()
    this.mode = 'playing'
    this.lastNow = nowMs
    this.emit()
  }

  toggle(nowMs: number): void {
    if (this.mode === 'paused') this.play(nowMs)
    else this.pause(nowMs)
  }

  /** Jump to a history time. From live this pauses there; while playing it keeps playing; reaching the edge goes live. */
  seek(T: number, nowMs: number): void {
    if (this.history.isEmpty) return
    const live = this.history.liveT(nowMs)
    const t = Math.min(live, Math.max(this.history.startT, T))
    if (live - t <= LIVE_EPS_MS && !this.scrubbing) return this.goLive()
    if (this.mode === 'live') this.pause(nowMs)
    this.T = t
    this.lastNow = nowMs
    this.emit()
  }

  goLive(): void {
    if (this.mode === 'live') return
    this.mode = 'live'
    this.emit()
  }

  /** Call every animation frame. Advances replay time while playing. */
  advance(nowMs: number): void {
    if (this.mode !== 'playing') {
      this.lastNow = nowMs
      return
    }
    const dt = Math.min(250, nowMs - this.lastNow) // a stalled tab must not leap
    this.lastNow = nowMs
    if (this.scrubbing) return
    this.T += dt
    if (this.history.liveT(nowMs) - this.T <= LIVE_EPS_MS) return this.goLive()
    this.revision += 1
  }

  /** Case closed or replaced: forget everything. */
  reset(): void {
    this.mode = 'live'
    this.T = 0
    this.scrubbing = false
    this.emit()
  }
}

export const playback = new Playback(history)
