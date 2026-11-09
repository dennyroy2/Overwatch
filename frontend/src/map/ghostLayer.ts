// deck.gl ghost layer, drawn INSIDE MapLibre's WebGL context (interleaved: true) so ghosts sit
// correctly among terrain and 3D buildings. Two ScatterplotLayers (soft halo + bright core) fed from the
// typed arrays with BINARY ATTRIBUTES: no per-point JS objects, no garbage-collection pauses mid-demo.
//
// Step 14: a requestAnimationFrame loop (outside React) blends between the last two data frames so ghosts
// glide at the display's frame rate; respawned slots snap and fade in (see stream/smoother.ts).
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import { TripsLayer } from '@deck.gl/geo-layers'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { attributionLayers, swarmDimFactor } from './attributionLayer'
import { whyLayers } from './whyLayer'
import { createGroundSampler, type GroundSampler } from './elevation'
import { CELL_METRES, CORE_OPACITY, GlowEase, densityStats } from './glow'
import { SoftDisc, WarmCore } from './softDisc'
import { attribution } from '@/stream/attribution'
import { currentBuffer, ghosts, onGhostFrame } from '@/stream/ghostBuffer'
import { perf } from '@/stream/perf'
import type { DissolveOutput } from '@/stream/dissolve'
import { GhostSmoother, type SmootherOutput } from '@/stream/smoother'
import { history } from '@/stream/history'
import { playback } from '@/stream/playback'
import { ReplayRenderer, type ReplayFrame } from '@/stream/replay'
import { useStore } from '@/store'
import { TRAIL_MS, TrailBuffer, type TrailOutput } from '@/stream/trails'

export interface GhostLayerHandle {
  sampler: GroundSampler
  dispose: () => void
}

/**
 * Glow = additive blending: overlapping light adds up, so dense areas get hotter and brighter by themselves
 * (colour saturates red, then green, then blue: dark -> amber -> near-white) and no legend is needed.
 * `depthWriteEnabled: false` keeps glows from hiding each other or the map; they still depth-test against terrain.
 */
const ADDITIVE = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one',
  depthWriteEnabled: false,
} as const

/**
 * A wide, soft halo per ghost: the density layer. Strong by choice (user, step 15); its opacity is set
 * every frame by glow.ts so a typical cell glows amber and denser-than-typical cells climb to white, whatever the swarm's overall density.
 */
export const HALO = { radiusMeters: 45, minPixels: 5, maxPixels: 36 } as const
/** A small bright core per ghost, so individual ghosts still read inside the glow. */
export const CORE = { radiusPixels: 2.2 } as const
/**
 * Fading comet tails on a subsample of ghosts (step 16): they show which way the swarm drifts. Warm
 * amber-white, lighter than the ghosts (user choice), never cyan. The colour is LINEAR light, like every
 * colour here (see GHOST_RGB_LINEAR): (1.0, 0.62, 0.22) displays as a light amber (255, 205, 128).
 */
export const TRAIL = { color: [255, 158, 56, 255] as [number, number, number, number], widthPixels: 1.2, opacity: 0.28 } as const

/** One shared instance: a new extension object per frame would make deck.gl rebuild the shader. */
const SOFT_EDGE = [new SoftDisc()]
const WARM_CORE = [new WarmCore()]

/** Time the render loop may spend per frame on ground-height grid work (60 fps leaves 16.7 ms). */
const GROUND_BUDGET_MS = 3

const NO_TRAILS: TrailOutput = { length: 0, path: new Float32Array(0), timestamps: new Float32Array(0), startIndices: new Uint32Array(1), currentTime: 0 }

/** Dev switch for the step 18 frame-rate measurements: ?trails=0 draws the swarm without trails. */
const TRAILS_ON = !(import.meta.env.DEV && new URLSearchParams(window.location.search).get('trails') === '0')

function makeLayers(out: SmootherOutput, trails: TrailOutput, glow: { halo: number; core: number }, dying: DissolveOutput | null = null, now = 0) {
  // While a card's red/cyan overlay shows (step 36), the amber swarm steps back so the ghosts visibly change colour.
  // Live picture only (`now` is 0 for a replayed one).
  if (now > 0) {
    const k = swarmDimFactor(now)
    if (k < 1) glow = { halo: glow.halo * k, core: glow.core * k }
  }
  const data = () => ({
    length: out.count,
    attributes: {
      getPosition: { value: out.pos, size: 3 },
      getFillColor: { value: out.col, size: 4 },
    },
  })
  // Both draw after buildings and before road/place labels (ids from map/style.ts).
  const common = { beforeId: 'highway-name-path', stroked: false, pickable: false, parameters: ADDITIVE }
  const haloLayer = [
    new ScatterplotLayer({
      ...common,
      id: 'ghost-halo',
      data: data(),
      getRadius: HALO.radiusMeters,
      radiusUnits: 'meters',
      radiusMinPixels: HALO.minPixels,
      radiusMaxPixels: HALO.maxPixels,
      opacity: glow.halo,
      extensions: SOFT_EDGE,
    }),
  ]
  const trailLayer = [
    new TripsLayer({
      ...common,
      id: 'ghost-trails',
      // Binary attributes: no per-trail objects. Vertex timestamps are ms relative to the first frame.
      data: {
        length: trails.length,
        startIndices: trails.startIndices,
        attributes: {
          getPath: { value: trails.path, size: 3 },
          getTimestamps: { value: trails.timestamps, size: 1 },
        },
      },
      getColor: TRAIL.color,
      getWidth: TRAIL.widthPixels,
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      fadeTrail: true,
      trailLength: TRAIL_MS,
      currentTime: trails.currentTime,
      // In a packed swarm the tails quiet down with the cores, so they never add to a white-out.
      opacity: TRAIL.opacity * (glow.core / CORE_OPACITY.max),
    })
  ]
  const coreLayer = [
    new ScatterplotLayer({
      ...common,
      id: 'ghost-core',
      data: data(),
      getRadius: CORE.radiusPixels,
      radiusUnits: 'pixels',
      opacity: glow.core,
      extensions: WARM_CORE,
    })
  ]
  // Ghosts that were just replaced stay and dissolve (step 35): the same halo and core, fading and shrinking to nothing.
  const dyingLayers = dying && dying.count > 0 ? dissolveLayers(dying, glow, common) : []
  // Order: dissolving ghosts under, then halo, trails, and cores on top.
  // "Why?" mode (step 37): a scrim over the swarm and the arcs to the evidence behind the selected cluster; then what the
  // selected card removed and kept (step 36), on top. Both only on the live picture (`now` is 0 for a replayed one).
  const why = now > 0 ? whyLayers(now, 'highway-name-path') : []
  const overlay = attributionLayers(now, 'highway-name-path')
  return TRAILS_ON ? [...dyingLayers, ...haloLayer, ...trailLayer, ...coreLayer, ...why, ...overlay] : [...dyingLayers, ...haloLayer, ...coreLayer, ...why, ...overlay]
}

/** The dissolving ghosts. Radii come per ghost, in pixels, already shrinking, so no minimum may hold them open. */
function dissolveLayers(d: DissolveOutput, glow: { halo: number; core: number }, common: Record<string, unknown>) {
  const data = (radius: Float32Array) => ({
    length: d.count,
    attributes: {
      getPosition: { value: d.pos, size: 3 },
      getFillColor: { value: d.col, size: 4 },
      getRadius: { value: radius, size: 1 },
    },
  })
  return [
    new ScatterplotLayer({ ...common, id: 'ghost-dying-halo', data: data(d.haloRadius), radiusUnits: 'pixels', radiusMinPixels: 0, radiusMaxPixels: 100, opacity: glow.halo, extensions: SOFT_EDGE }),
    new ScatterplotLayer({ ...common, id: 'ghost-dying-core', data: data(d.coreRadius), radiusUnits: 'pixels', radiusMinPixels: 0, radiusMaxPixels: 100, opacity: glow.core, extensions: WARM_CORE }),
  ]
}

/** MapLibre (512 px tiles): metres on the ground per screen pixel at the map centre. */
const metresPerPixel = (map: MapLibreMap): number => (78271.51696 * Math.cos((map.getCenter().lat * Math.PI) / 180)) / 2 ** map.getZoom()

/** What a live ghost's halo radius is on screen right now, in pixels, so a dissolving one shrinks from the same size. */
const liveHaloPixels = (map: MapLibreMap): number => Math.min(HALO.maxPixels, Math.max(HALO.minPixels, HALO.radiusMeters / metresPerPixel(map)))

const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/** Dev switch for watching the dissolve: ?slowmo=8 slows the fade-in and the dissolve eight times. */
const SLOWMO = import.meta.env.DEV ? Number(new URLSearchParams(window.location.search).get('slowmo')) || 1 : 1

export function attachGhosts(map: MapLibreMap): GhostLayerHandle {
  // Dev switch for isolating map issues: ?ghostlayer=0 skips deck.gl entirely.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('ghostlayer') === '0') {
    return { sampler: createGroundSampler(map), dispose: () => {} }
  }
  const overlay = new MapboxOverlay({ interleaved: true, layers: [] })
  map.addControl(overlay)
  const sampler = createGroundSampler(map)
  // Dev switch for the step-11 terrain check: ?ghostz=0 leaves ghosts at z = 0 (sea level).
  const sampleGround = !(import.meta.env.DEV && new URLSearchParams(window.location.search).get('ghostz') === '0')

  const smoother = new GhostSmoother()
  smoother.configure({ slowmo: SLOWMO, reducedMotion: prefersReducedMotion() })
  const glow = new GlowEase()
  const trails = new TrailBuffer()
  const renderer = new ReplayRenderer()
  let lastLive: SmootherOutput | null = null

  // Data side: a new frame arrived. Put ghosts on the ground, record it, and tell the smoother.
  // This always runs, even while the screen is paused: the stream keeps being recorded.
  const onFrame = () => {
    const count = ghosts.count
    if (count > 0 && sampleGround) sampler.apply(currentBuffer(), count)
    smoother.onFrame(ghosts.receivedAt, currentBuffer(), count, ghosts.respawned, ghosts.allRespawned)
    attribution.onKills(smoother.kills) // the deaths in this frame go to the latest evidence (step 36)
    trails.onFrame(ghosts.receivedAt, count, smoother) // after the smoother: it reads what the smoother just decided
    perf.trails = trails.trailCount
    const store = useStore.getState()
    history.onFrame({
      arrivalMs: ghosts.receivedAt,
      cur: currentBuffer(),
      count,
      allRespawned: smoother.respawnedAll,
      wasRespawned: (i) => smoother.wasRespawned(i),
      simTime: ghosts.simTime,
      clusters: store.clusters,
      alive: store.ghostMeta.aliveFraction,
    })
    if (count === 0) {
      glow.reset()
      playback.reset() // the case closed or was replaced: back to live
      store.setReplayView(null)
    } else if (playback.isLive) {
      // Only the live picture drives the glow here; a paused or replayed picture sets it from its own frame.
      const d = densityStats(currentBuffer(), count)
      glow.setDensity(d.meanOccupied)
      perf.peakPerCell = d.peak
      perf.typicalPerCell = d.meanOccupied
    }
  }
  const off = onGhostFrame(onFrame)

  // What the screen shows right now, so "pause" can freeze that exact frame.
  playback.setCapture(() => {
    const store = useStore.getState()
    if (!lastLive || lastLive.count === 0) return null
    return {
      drawn: lastLive.pos,
      count: lastLive.count,
      weights: currentBuffer(),
      simTime: ghosts.simTime,
      clusters: store.clusters,
      alive: store.ghostMeta.aliveFraction,
    }
  })
  const offMode = playback.onChange(() => useStore.getState().setReplayMode(playback.mode))

  // Render side: every animation frame, blend and hand the result to deck.gl. No React involved.
  let raf = 0
  let drawnEmpty = false
  let fpsFrames = 0
  let fpsSince = performance.now()
  // Replay bookkeeping: redraw a paused picture only while something is still changing (a seek, the glow easing).
  let replayFrame: ReplayFrame | null = null
  let renderedVersion = -1
  let settleUntil = 0
  let lastViewPush = 0
  let lastKeyframe = -1

  const drawReplay = (now: number) => {
    if (playback.version !== renderedVersion || playback.mode === 'playing') {
      renderedVersion = playback.version
      replayFrame = renderer.render(history, playback.T, liveHaloPixels(map), CORE.radiusPixels, smoother.dissolve.durationMs)
      perf.dissolving = replayFrame ? replayFrame.dying.count : 0
      if (replayFrame && replayFrame.out.count > 0) {
        const d = densityStats(replayFrame.out.pos, replayFrame.out.count, CELL_METRES, 3)
        glow.setDensity(d.meanOccupied)
        perf.peakPerCell = d.peak
        perf.typicalPerCell = d.meanOccupied
        // Rings and the sim clock follow the recorded moment (throttled; they change slowly).
        if (replayFrame.keyframe !== lastKeyframe || now - lastViewPush >= 100) {
          lastKeyframe = replayFrame.keyframe
          lastViewPush = now
          useStore.getState().setReplayView({ t: playback.T, clusters: replayFrame.clusters, simTime: replayFrame.simTime, alive: replayFrame.alive })
        }
      }
      settleUntil = now + 700 // let the glow ease to its new level
    }
    glow.step(now)
    perf.haloOpacity = glow.halo
    if (replayFrame && replayFrame.out.count > 0 && now < settleUntil) {
      overlay.setProps({ layers: makeLayers(replayFrame.out, TRAILS_ON ? replayFrame.trails : NO_TRAILS, glow, replayFrame.dying) })
      drawnEmpty = false
    }
  }

  const loop = (now: number) => {
    const t0 = performance.now()
    // Slice of ground-height work (a few ms at most); when a new grid swaps in, re-seat the ghosts on it.
    if (sampleGround) {
      sampler.step(GROUND_BUDGET_MS)
      if (sampler.takeSwapped() && ghosts.count > 0) sampler.apply(currentBuffer(), ghosts.count)
    }
    playback.advance(now)
    // A stopped simulation (debug Close, subject found) freezes the live clock: nothing moves, the picture stays.
    const liveNow = history.haltedAt ?? now
    const out = smoother.tick(liveNow) // always tick: the live picture keeps going behind a paused one
    lastLive = out
    if (!playback.isLive) {
      drawReplay(now)
    } else {
      if (replayFrame) {
        // Just went live again: drop the recorded picture and let the live one take over.
        replayFrame = null
        renderedVersion = -1
        lastKeyframe = -1
        useStore.getState().setReplayView(null)
      }
      if (out.count > 0) {
        glow.step(liveNow)
        perf.haloOpacity = glow.halo
        // With trails off (dev switch), skip building them too, so the measurement shows the real saving.
        const dying = smoother.dissolve.tick(liveNow, liveHaloPixels(map), CORE.radiusPixels)
        perf.dissolving = dying.count
        overlay.setProps({ layers: makeLayers(out, TRAILS_ON ? trails.tick(liveNow, out.pos) : NO_TRAILS, glow, dying, now) })
        drawnEmpty = false
      } else if (!drawnEmpty) {
        overlay.setProps({ layers: [] })
        drawnEmpty = true
      }
    }
    perf.workMs = performance.now() - t0
    fpsFrames += 1
    if (now - fpsSince >= 500) {
      perf.fps = (fpsFrames * 1000) / (now - fpsSince)
      fpsFrames = 0
      fpsSince = now
    }
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>
    w.__smoother = smoother
    w.__trails = trails
    w.__perf = perf
    w.__history = history
    w.__playback = playback
    w.__attribution = attribution
    w.__replayRenderer = renderer
  }
  // New terrain tiles arriving is the only thing that can fill grid holes; camera moves don't matter.
  const onSourceData = (e: { sourceId?: string }) => { if (e.sourceId === 'terrain-dem') sampler.markStale() }
  map.on('sourcedata', onSourceData)
  onFrame()

  return {
    sampler,
    dispose: () => {
      off()
      offMode()
      playback.setCapture(null)
      cancelAnimationFrame(raf)
      map.off('sourcedata', onSourceData)
      map.removeControl(overlay)
      overlay.finalize()
    },
  }
}
