import { useEffect, useState } from 'react'
import type { MapMouseEvent } from 'maplibre-gl'
import { getMap } from '@/map/mapRef'
import { TERRAIN_EXAGGERATION } from '@/map/style'
import { utmString } from '@/lib/utm'
import { useStore } from '@/store'

interface Readout { utm: string; lat: number; lon: number; elev: number | null }

/**
 * Cursor coordinates the way search teams read them, like CalTopo's box: UTM first, then decimal
 * lat/lon, ground elevation and the datum (field feedback: "operators use that").
 * Shows the last-seen point until the cursor moves over the map.
 */
export function CoordReadout() {
  const rightOpen = useStore((s) => s.ui.panels.right)
  const lastSeen = useStore((s) => s.caseProfile?.last_seen ?? null)
  const [r, setR] = useState<Readout | null>(null)

  useEffect(() => {
    let raf = 0
    let attached: ReturnType<typeof getMap> = null
    const onMove = (e: MapMouseEvent) => {
      const { lng, lat } = e.lngLat
      let elev: number | null = null
      try {
        const h = attached?.queryTerrainElevation(e.lngLat)
        // MapLibre returns the exaggerated height; divide it back out to get metres above sea level
        if (typeof h === 'number' && Number.isFinite(h)) elev = h / TERRAIN_EXAGGERATION
      } catch { elev = null }
      setR({ utm: utmString(lng, lat), lat, lon: lng, elev })
    }
    const attach = () => {
      const map = getMap()
      if (!map) { raf = requestAnimationFrame(attach); return }
      attached = map
      map.on('mousemove', onMove)
    }
    attach()
    return () => { cancelAnimationFrame(raf); attached?.off('mousemove', onMove) }
  }, [])

  const shown: Readout | null = r ?? (lastSeen ? { utm: utmString(lastSeen.lon, lastSeen.lat), lat: lastSeen.lat, lon: lastSeen.lon, elev: null } : null)
  if (!shown) return null
  return (
    <div
      className="pointer-events-none absolute top-[4.25rem] z-10 rounded-md border border-line bg-panel/95 px-3 py-1.5 text-right shadow-panel"
      style={{ right: rightOpen ? 'calc(var(--ow-rail-width) + 1.5rem)' : '4.5rem' }}
      aria-label="Cursor coordinates"
      data-testid="coord-readout"
    >
      <p className="font-mono text-md text-ink">{shown.utm}</p>
      <p className="font-mono text-sm text-ink-2">{shown.lat.toFixed(5)}, {shown.lon.toFixed(5)}</p>
      <p className="font-mono text-sm text-ink-2">
        {shown.elev === null ? '----' : `${Math.round(shown.elev)} m`}
        <span className="ml-3 text-ink-3">WGS84</span>
      </p>
    </div>
  )
}
