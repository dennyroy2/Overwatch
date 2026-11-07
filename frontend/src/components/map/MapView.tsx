import { useEffect, useRef } from 'react'
import { AttributionControl, Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { overviewCamera, watchCase } from '@/map/camera'
import { setMap } from '@/map/mapRef'
import { attachGhosts } from '@/map/ghostLayer'
import { loadStyle } from '@/map/style'
import { currentBuffer, ghosts } from '@/stream/ghostBuffer'

/** Full-bleed 3D map (layer 0). Panels float over it; nothing resizes it. */
export function MapView() {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let map: MapLibreMap | null = null
    let unwatch = () => {}
    let detachGhosts = () => {}

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
      const ghostHandle = attachGhosts(map)
      detachGhosts = ghostHandle.dispose
      if (import.meta.env.DEV) {
        // Dev-only handles for automated checks and the browser console.
        const w = window as unknown as Record<string, unknown>
        w.__ghostStats = ghostHandle.sampler.stats
        w.__ghosts = ghosts
        w.__currentBuffer = currentBuffer
      }
    })

    return () => {
      cancelled = true
      unwatch()
      detachGhosts()
      setMap(null)
      map?.remove()
    }
  }, [])

  return <div ref={container} className="h-full w-full bg-ground" aria-label="Map of the search area" role="application" />
}
