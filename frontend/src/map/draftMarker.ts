// The last-seen point being picked while the New case sheet is open: a click on the map sets it,
// and an amber ring marks it. Draft input only (never backend data). Click handling and the marker
// live here, outside React, like the rest of the map code.
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { fromLngLat, toLngLat, type LngLat } from '@/lib/geo'
import { useStore } from '@/store'

function markerElement(): HTMLElement {
  const el = document.createElement('div')
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', 'Last seen point')
  el.style.cssText = [
    'width:22px', 'height:22px', 'border-radius:9999px',
    'border:2px solid var(--ow-amber)', 'background:var(--ow-amber-wash)',
    'box-shadow:0 2px 8px rgb(0 0 0 / 0.6)', 'display:grid', 'place-items:center', 'pointer-events:none',
  ].join(';')
  const dot = document.createElement('div')
  dot.style.cssText = 'width:6px;height:6px;border-radius:9999px;background:var(--ow-amber)'
  el.appendChild(dot)
  return el
}

export function watchDraftLastSeen(map: MapLibreMap): () => void {
  let marker: Marker | null = null

  const onClick = (e: { lngLat: LngLat }) => {
    const s = useStore.getState()
    if (s.ui.panels.newCase) s.setDraftLastSeen(fromLngLat(e.lngLat))
  }
  map.on('click', onClick)

  const sync = () => {
    const { draftLastSeen, panels } = useStore.getState().ui
    map.getCanvas().style.cursor = panels.newCase ? 'crosshair' : ''
    if (draftLastSeen && panels.newCase) {
      if (!marker) marker = new Marker({ element: markerElement(), opacityWhenCovered: 1 }).setLngLat(toLngLat(draftLastSeen)).addTo(map)
      else marker.setLngLat(toLngLat(draftLastSeen))
    } else if (marker) {
      marker.remove()
      marker = null
    }
  }
  sync()
  const unsub = useStore.subscribe(sync)

  return () => {
    unsub()
    map.off('click', onClick)
    marker?.remove()
    map.getCanvas().style.cursor = ''
  }
}
