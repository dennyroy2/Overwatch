import { useEffect, useRef } from 'react'
import { AttributionControl, Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 loads its worker from a URL; Vite must serve it as an asset or tiles never parse.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { overviewCamera, watchCase } from '@/map/camera'
import { setMap } from '@/map/mapRef'
import { loadStyle } from '@/map/style'

setWorkerUrl(workerUrl)

/** Full-bleed 3D map (layer 0). Panels float over it; nothing resizes it. */
export function MapView() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let map: MapLibreMap | null = null
    let unwatch = () => {}

    void loadStyle().then((style) => {
      if (cancelled || !container.current) return
      map = new MapLibreMap({
        container: container.current,
        style,
        ...overviewCamera(),
        maxPitch: 80,
        attributionControl: false,
      })
      map.addControl(
        new AttributionControl({
          compact: true,
          customAttribution: ['OpenFreeMap', '&copy; OpenMapTiles', 'Data &copy; OpenStreetMap contributors'],
        }),
        'bottom-left',
      )
      // Tile hiccups must never take the screen down.
      map.on('error', (e) => console.warn('map:', e.error?.message ?? e))
      setMap(map)
      unwatch = watchCase(map)
    })

    return () => {
      cancelled = true
      unwatch()
      setMap(null)
      map?.remove()
    }
  }, [])

  return <div ref={container} className="h-full w-full bg-ground" aria-label="Map of the search area" role="application" />
}
