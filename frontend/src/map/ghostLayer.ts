// deck.gl ghost layer, drawn INSIDE MapLibre's WebGL context (interleaved: true) so ghosts sit
// correctly among terrain and 3D buildings. One ScatterplotLayer fed from the typed array with
// BINARY ATTRIBUTES: no per-point JS objects, no garbage-collection pauses mid-demo.
//
// Step 14: a requestAnimationFrame loop (outside React) blends between the last two data frames so ghosts
// glide at the display's frame rate; respawned slots snap and fade in (see stream/smoother.ts).
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { createGroundSampler, type GroundSampler } from './elevation'
import { currentBuffer, ghosts, onGhostFrame } from '@/stream/ghostBuffer'
import { perf } from '@/stream/perf'
import { GhostSmoother, type SmootherOutput } from '@/stream/smoother'

export interface GhostLayerHandle {
  sampler: GroundSampler
  dispose: () => void
}

function makeLayer(out: SmootherOutput) {
  return new ScatterplotLayer({
    id: 'ghosts',
    // Draw after buildings, before road/place labels (ids from map/style.ts).
    beforeId: 'highway-name-path',
    data: {
      length: out.count,
      attributes: {
        getPosition: { value: out.pos, size: 3 },
        getFillColor: { value: out.col, size: 4 },
      },
    },
    getRadius: 2.5,
    radiusUnits: 'pixels',
    radiusMinPixels: 1.5,
    stroked: false,
    pickable: false,
  })
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

  // Data side: a new frame arrived. Put ghosts on the ground, then tell the smoother.
  const onFrame = () => {
    const count = ghosts.count
    if (count > 0 && sampleGround) sampler.apply(currentBuffer(), count)
    smoother.onFrame(ghosts.receivedAt, currentBuffer(), count, ghosts.respawned, ghosts.allRespawned)
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
      overlay.setProps({ layers: [makeLayer(out)] })
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
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__smoother = smoother
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
