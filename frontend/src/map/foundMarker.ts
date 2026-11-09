// The "possible match" on the map (step 24): a pulsing marker where the AI thinks the subject may be, and one
// camera move to it when it first arrives while live. It only asks the officer to confirm; it never says "found"
// (hard rule 8). The marker stays after a "Not a match" dismissal so the sighting is not lost.
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { foundKey } from '@/lib/close'
import { foundVisibleAt } from '@/lib/replayState'
import { history } from '@/stream/history'
import { toLngLat } from '@/lib/geo'
import { useStore } from '@/store'
import { flyToPoint } from './camera'

export function watchFound(map: MapLibreMap): () => void {
  let marker: Marker | null = null
  let shownKey: string | null = null

  const sync = () => {
    const s = useStore.getState()
    // Only from the moment it arrived, while a recorded moment is on screen (step 38).
    const visible = foundVisibleAt({ mode: s.ui.replay.mode, t: s.replayView?.t ?? null }, history)
    const key = visible ? foundKey(s.found) : null
    if (key === shownKey) return
    shownKey = key
    marker?.remove()
    marker = null
    const f = visible ? s.found : null
    if (!f) return
    const el = document.createElement('div')
    el.className = 'ow-found'
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', 'Possible match, awaiting officer confirmation')
    el.innerHTML = '<span class="ow-found__pulse"></span><span class="ow-found__pulse ow-found__pulse--late"></span><span class="ow-found__core"></span>'
    marker = new Marker({ element: el, anchor: 'center', opacityWhenCovered: 1 }).setLngLat(toLngLat(f.location)).addTo(map)
    if (s.ui.replay.mode === 'live') flyToPoint(map, f.location, 16)
  }

  sync()
  const unsub = useStore.subscribe(sync)
  return () => {
    unsub()
    marker?.remove()
  }
}
