// deck.gl ghost layer, drawn INSIDE MapLibre's WebGL context (interleaved: true) so ghosts sit
// correctly among terrain and 3D buildings. One ScatterplotLayer fed from the typed array with
// BINARY ATTRIBUTES: no per-point JS objects, no garbage-collection pauses mid-demo.
//
// Step 11: positions are drawn exactly as they arrive (no smoothing). Step 14 adds interpolation.
import { MapboxOverlay } from '@deck.gl/mapbox'
import { ScatterplotLayer } from '@deck.gl/layers'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { createGroundSampler, type GroundSampler } from './elevation'
import { currentBuffer, GHOST_STRIDE_BYTES, ghosts, onGhostFrame, OFFSET } from '@/stream/ghostBuffer'

/** Restrained warm tone, never cyan (cyan is reserved for the AI). Glow and density come in step 15. */
const GHOST_COLOR: [number, number, number, number] = [255, 196, 110, 170]

export interface GhostLayerHandle {
  sampler: GroundSampler
  dispose: () => void
}

function makeLayer(buf: Float32Array, count: number) {
  return new ScatterplotLayer({
    id: 'ghosts',
    // Draw after buildings, before road/place labels (ids from map/style.ts).
    beforeId: 'highway-name-path',
    data: {
      length: count,
      attributes: {
        getPosition: { value: buf, size: 3, stride: GHOST_STRIDE_BYTES, offset: OFFSET.longitude * 4 },
      },
    },
    getFillColor: GHOST_COLOR,
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

  const render = () => {
    const count = ghosts.count
    const buf = currentBuffer()
    if (count > 0 && sampleGround) sampler.apply(buf, count)
    overlay.setProps({ layers: count > 0 ? [makeLayer(buf, count)] : [] })
  }
  const off = onGhostFrame(render)
  // New terrain tiles arriving is the only thing that can fill grid holes; camera moves don't matter.
  const onSourceData = (e: { sourceId?: string }) => { if (e.sourceId === 'terrain-dem') sampler.markStale() }
  map.on('sourcedata', onSourceData)
  render()

  return {
    sampler,
    dispose: () => {
      off()
      map.off('sourcedata', onSourceData)
      map.removeControl(overlay)
      overlay.finalize()
    },
  }
}
