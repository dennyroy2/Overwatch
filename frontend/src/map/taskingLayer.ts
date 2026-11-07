// A tasking request's target area on the map (step 21): while the pointer is on its card (or its row in the
// Decided list) the area is outlined in amber with a faint fill. Step 23 builds the "being searched" and route
// drawing on top of the same source. Follows the store only (the screen is a view, hard rule 3).
import type { Map as MapLibreMap } from 'maplibre-gl'
import { targetRing } from '@/lib/tasking'
import { useStore } from '@/store'

const SOURCE_ID = 'tasking-hover'

export function watchTasking(map: MapLibreMap): () => void {
  let disposed = false
  let ready = false
  let last: { hovered: string | null; requests: unknown } = { hovered: null, requests: null }

  const sync = () => {
    if (disposed || !ready) return
    const s = useStore.getState()
    if (last.hovered === s.ui.hoveredRequestId && last.requests === s.requests) return
    last = { hovered: s.ui.hoveredRequestId, requests: s.requests }
    const r = s.ui.hoveredRequestId ? s.requests.byId[s.ui.hoveredRequestId] : null
    const ring = r ? targetRing(r) : null
    ;(map.getSource(SOURCE_ID) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined)?.setData({
      type: 'FeatureCollection',
      features: ring ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] : [],
    })
  }

  const init = () => {
    if (disposed) return
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    // Under the 3D buildings like the other areas, so it reads as ground, not as an object.
    const below = map.getLayer('building-3d') ? 'building-3d' : undefined
    map.addLayer({ id: 'tasking-hover-fill', type: 'fill', source: SOURCE_ID, paint: { 'fill-color': '#ffb224', 'fill-opacity': 0.16 } }, below)
    map.addLayer({ id: 'tasking-hover-line', type: 'line', source: SOURCE_ID, paint: { 'line-color': '#ffb224', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } }, below)
    ready = true
    last = { hovered: null, requests: null }
    sync()
  }
  if (map.loaded()) init()
  else map.once('load', init)

  const unsub = useStore.subscribe(sync)
  return () => {
    disposed = true
    unsub()
  }
}
