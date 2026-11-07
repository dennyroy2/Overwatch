// What an APPROVED request looks like on the map (step 23).
//
//   * the moment the stream confirms an approval that the officer was waiting on, the route DRAWS itself across
//     the map (about 2.6 s, eased) with a glowing dot travelling along its tip, and the camera eases to frame the
//     route and its target. This is the visual proof that a human decision just happened.
//   * afterwards, and for any request that was already approved when it first appeared (a reload, a replay),
//     the route stays as a faint line, the dot rests at the target, and the target area stays tinted amber with
//     a small "<asset> searching" label, so the map always shows what the officer has set in motion.
//
// It follows the store only (hard rule 3): nothing draws on a click, only when the stream says "approved".
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { toLngLat, toLonLat } from '@/lib/geo'
import { requestState } from '@/lib/decision'
import { visibleAt } from '@/lib/evidence'
import { ROUTE_MS, easeInOut, partialRoute, pointAlong } from '@/lib/route'
import { areaCentre, decisionFor, effectiveAsset, targetRing, type Request } from '@/lib/tasking'
import { useStore } from '@/store'
import { history } from '@/stream/history'
import { frameRoute } from './camera'

const AREAS = 'approved-areas'
const ROUTES = 'approved-routes'
const DRAW = 'route-drawing'
const DOTS = 'route-dots'
const AMBER = '#ffb224'
// The swarm underneath is amber-orange, so a plain amber line vanishes into it. The route is a pale warm-white core
// with a dark casing (readable on the glow) and an amber halo (still the colour of a human decision).
const CORE = '#fff3d6'
const CASING = '#06080b'

type Src = { setData: (d: GeoJSON.FeatureCollection) => void }
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const line = (coords: [number, number][], props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } })
const dot = (c: [number, number], props: Record<string, unknown> = {}): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } })

const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

interface Anim {
  request: Request
  start: number
}

export function watchRoutes(map: MapLibreMap): () => void {
  let disposed = false
  let ready = false
  let raf = 0
  const seenWaiting = new Set<string>() // requests we saw while they were still waiting on the officer
  const shown = new Set<string>() // approved requests already handled (animated or drawn static)
  const anims = new Map<string, Anim>()
  const labels = new Map<string, { marker: Marker; el: HTMLDivElement }>()
  let last: { requests: unknown; log: unknown; decisions: unknown; mode: string; t: number | null } = { requests: null, log: null, decisions: null, mode: '', t: null }

  const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as unknown as Src | undefined)?.setData(data)

  /** The tip of every running animation, redrawn each frame. */
  const frame = (now: number) => {
    raf = 0
    if (disposed) return
    const drawing: GeoJSON.Feature[] = []
    const heads: GeoJSON.Feature[] = []
    for (const [id, a] of anims) {
      const t = (now - a.start) / ROUTE_MS
      const f = easeInOut(t)
      const route = a.request.route
      drawing.push(line(partialRoute(route, f).map(toLonLat), { id }))
      const head = pointAlong(route, f)
      if (head) heads.push(dot(toLonLat(head), { id, travelling: true }))
      if (t >= 1) anims.delete(id)
    }
    set(DRAW, fc(drawing))
    set(DOTS, fc([...heads, ...restingDots()]))
    if (anims.size > 0) raf = requestAnimationFrame(frame)
    else {
      // Animation finished: the bright line goes, and the faint route and the resting dot take over.
      set(DRAW, fc([]))
      syncStatic()
    }
  }

  const restingDots = (): GeoJSON.Feature[] => {
    const out: GeoJSON.Feature[] = []
    for (const id of shown) {
      if (anims.has(id)) continue
      const r = useStore.getState().requests.byId[id]
      const end = r?.route?.[r.route.length - 1]
      if (r && end) out.push(dot(toLonLat(end), { id, travelling: false }))
    }
    return out
  }

  const syncStatic = () => {
    if (!ready) return
    const s = useStore.getState()
    const areas: GeoJSON.Feature[] = []
    const routes: GeoJSON.Feature[] = []
    const keep = new Set<string>()
    for (const id of shown) {
      const r = s.requests.byId[id]
      if (!r) continue
      const ring = targetRing(r)
      if (ring) areas.push({ type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: [ring] } })
      if (!anims.has(id) && r.route.length >= 2) routes.push(line(r.route.map(toLonLat), { id }))
      // The label sits at the middle of the area and says who is searching (an edited approval names the replacement).
      const c = areaCentre(r)
      if (c) {
        keep.add(id)
        const asset = effectiveAsset(r.asset, decisionFor(s.log, { asset: r.asset, status: 'approved' })?.reason)
        let l = labels.get(id)
        if (!l) {
          const el = document.createElement('div')
          el.className = 'ow-searching'
          l = { el, marker: new Marker({ element: el, anchor: 'center', opacityWhenCovered: 1 }).setLngLat(toLngLat(c)).addTo(map) }
          labels.set(id, l)
        }
        l.el.textContent = `${asset} searching`
        l.el.hidden = anims.has(id) // appears when the route has arrived
        l.marker.setLngLat(toLngLat(c))
      }
    }
    for (const [id, l] of labels) if (!keep.has(id)) { l.marker.remove(); labels.delete(id) }
    set(AREAS, fc(areas))
    set(ROUTES, fc(routes))
    if (anims.size === 0) set(DOTS, fc(restingDots()))
  }

  const sync = () => {
    if (disposed || !ready) return
    const s = useStore.getState()
    const t = s.replayView?.t ?? null
    if (last.requests === s.requests && last.log === s.log && last.decisions === s.decisions && last.mode === s.ui.replay.mode && last.t === t) return
    last = { requests: s.requests, log: s.log, decisions: s.decisions, mode: s.ui.replay.mode, t }

    if (s.requests.order.length === 0 && (shown.size > 0 || seenWaiting.size > 0)) {
      // A new case or a lost one: forget everything.
      shown.clear(); seenWaiting.clear(); anims.clear()
    }
    const replay = { mode: s.ui.replay.mode, t }
    const startNow: Request[] = []
    for (const id of s.requests.order) {
      const r = s.requests.byId[id]
      if (!visibleAt(replay, history.firstSeen.get(id))) {
        if (shown.has(id) && s.ui.replay.mode !== 'live') { shown.delete(id); anims.delete(id) }
        continue
      }
      const st = requestState(r, s.log, s.decisions[id])
      if (st === 'pending' || st === 'sending') seenWaiting.add(id)
      else if (st === 'approved' && !shown.has(id)) {
        shown.add(id)
        // Animate only a decision we watched happen, live. A request that arrives already approved just appears.
        if (seenWaiting.has(id) && s.ui.replay.mode === 'live' && !prefersReducedMotion() && r.route.length >= 2) startNow.push(r)
        else if (seenWaiting.has(id) && s.ui.replay.mode === 'live') frameRoute(map, [...r.route, ...r.target_area])
      }
    }
    for (const r of startNow) {
      anims.set(r.id, { request: r, start: performance.now() })
      frameRoute(map, [...r.route, ...r.target_area])
    }
    syncStatic()
    if (anims.size > 0 && raf === 0) raf = requestAnimationFrame(frame)
  }

  const init = () => {
    if (disposed) return
    for (const id of [AREAS, ROUTES, DRAW, DOTS]) map.addSource(id, { type: 'geojson', data: fc([]) })
    // The tinted area is ground, so it sits under the 3D buildings like the other areas. The route and the dot are
    // the point of the moment and draw on top of everything.
    const below = map.getLayer('building-3d') ? 'building-3d' : undefined
    map.addLayer({ id: 'approved-areas-fill', type: 'fill', source: AREAS, paint: { 'fill-color': AMBER, 'fill-opacity': 0.14 } }, below)
    // Area outlines sit above the swarm (a dark casing and a pale dashed line) so "being searched" is readable anywhere.
    map.addLayer({ id: 'approved-areas-casing', type: 'line', source: AREAS, paint: { 'line-color': CASING, 'line-opacity': 0.7, 'line-width': 5 } })
    map.addLayer({ id: 'approved-areas-line', type: 'line', source: AREAS, paint: { 'line-color': CORE, 'line-opacity': 0.95, 'line-width': 2, 'line-dasharray': [3, 2] } })
    const round = { 'line-cap': 'round', 'line-join': 'round' } as const
    map.addLayer({ id: 'approved-routes-casing', type: 'line', source: ROUTES, layout: round, paint: { 'line-color': CASING, 'line-opacity': 0.55, 'line-width': 5 } })
    map.addLayer({ id: 'approved-routes-line', type: 'line', source: ROUTES, layout: round, paint: { 'line-color': CORE, 'line-opacity': 0.75, 'line-width': 2.2 } })
    map.addLayer({ id: 'route-drawing-glow', type: 'line', source: DRAW, layout: round, paint: { 'line-color': AMBER, 'line-opacity': 0.55, 'line-width': 16, 'line-blur': 8 } })
    map.addLayer({ id: 'route-drawing-casing', type: 'line', source: DRAW, layout: round, paint: { 'line-color': CASING, 'line-opacity': 0.8, 'line-width': 8 } })
    map.addLayer({ id: 'route-drawing-line', type: 'line', source: DRAW, layout: round, paint: { 'line-color': CORE, 'line-opacity': 1, 'line-width': 4 } })
    map.addLayer({ id: 'route-dots-glow', type: 'circle', source: DOTS, paint: { 'circle-radius': ['case', ['get', 'travelling'], 20, 11], 'circle-color': AMBER, 'circle-opacity': ['case', ['get', 'travelling'], 0.55, 0.35], 'circle-blur': 1 } })
    map.addLayer({ id: 'route-dots-core', type: 'circle', source: DOTS, paint: { 'circle-radius': ['case', ['get', 'travelling'], 6.5, 4.5], 'circle-color': CORE, 'circle-stroke-color': CASING, 'circle-stroke-width': 2.5 } })
    ready = true
    last = { requests: null, log: null, decisions: null, mode: '', t: null }
    sync()
  }
  if (map.loaded()) init()
  else map.once('load', init)

  const unsub = useStore.subscribe(sync)
  return () => {
    disposed = true
    unsub()
    if (raf) cancelAnimationFrame(raf)
    for (const l of labels.values()) l.marker.remove()
    labels.clear()
  }
}
