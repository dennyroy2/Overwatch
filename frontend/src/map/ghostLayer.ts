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
import { createGroundSampler, type GroundSampler } from './elevation'
import { CORE_OPACITY, GlowEase, densityStats } from './glow'
import { SoftDisc, WarmCore } from './softDisc'
import { currentBuffer, ghosts, onGhostFrame } from '@/stream/ghostBuffer'
import { perf } from '@/stream/perf'
import { GhostSmoother, type SmootherOutput } from '@/stream/smoother'
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
export const TRAIL = { color: [255, 158, 56, 255] as [number, number, number, number], widthPixels: 1.6, opacity: 0.6 } as const

/** One shared instance: a new extension object per frame would make deck.gl rebuild the shader. */
const SOFT_EDGE = [new SoftDisc()]
const WARM_CORE = [new WarmCore()]

function makeLayers(out: SmootherOutput, trails: TrailOutput, glow: { halo: number; core: number }) {
  const data = () => ({
    length: out.count,
    attributes: {
      getPosition: { value: out.pos, size: 3 },
      getFillColor: { value: out.col, size: 4 },
    },
  })
  // Both draw after buildings and before road/place labels (ids from map/style.ts).
  const common = { beforeId: 'highway-name-path', stroked: false, pickable: false, parameters: ADDITIVE }
  return [
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
    }),
    new ScatterplotLayer({
      ...common,
      id: 'ghost-core',
      data: data(),
      getRadius: CORE.radiusPixels,
      radiusUnits: 'pixels',
      opacity: glow.core,
      extensions: WARM_CORE,
    }),
  ]
}

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
  const glow = new GlowEase()
  const trails = new TrailBuffer()

  // Data side: a new frame arrived. Put ghosts on the ground, then tell the smoother.
  const onFrame = () => {
    const count = ghosts.count
    if (count > 0 && sampleGround) sampler.apply(currentBuffer(), count)
    smoother.onFrame(ghosts.receivedAt, currentBuffer(), count, ghosts.respawned, ghosts.allRespawned)
    trails.onFrame(ghosts.receivedAt, count, smoother) // after the smoother: it reads what the smoother just decided
    perf.trails = trails.trailCount
    if (count === 0) glow.reset()
    else {
      const d = densityStats(currentBuffer(), count)
      glow.setDensity(d.meanOccupied)
      perf.peakPerCell = d.peak
      perf.typicalPerCell = d.meanOccupied
    }
  }
  const off = onGhostFrame(onFrame)

  // Render side: every animation frame, blend and hand the result to deck.gl. No React involved.
  let raf = 0
  let drawnEmpty = false
  let fpsFrames = 0
  let fpsSince = performance.now()
  const loop = (now: number) => {
    const t0 = performance.now()
    const out = smoother.tick(now)
    if (out.count > 0) {
      glow.step(now)
      perf.haloOpacity = glow.halo
      overlay.setProps({ layers: makeLayers(out, trails.tick(now, out.pos), glow) })
      drawnEmpty = false
    } else if (!drawnEmpty) {
      overlay.setProps({ layers: [] })
      drawnEmpty = true
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
  }
  // New terrain tiles arriving is the only thing that can fill grid holes; camera moves don't matter.
  const onSourceData = (e: { sourceId?: string }) => { if (e.sourceId === 'terrain-dem') sampler.markStale() }
  map.on('sourcedata', onSourceData)
  onFrame()

  return {
    sampler,
    dispose: () => {
      off()
      cancelAnimationFrame(raf)
      map.off('sourcedata', onSourceData)
      map.removeControl(overlay)
      overlay.finalize()
    },
  }
}
