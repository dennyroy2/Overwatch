// Evidence on the map (step 19): a pin or small marker for sightings, clues, favourite places and the
// last-seen point, and a muted hatched shape for areas that were searched or are off limits. Both follow the
// store (the screen is a view, hard rule 3) and the replay time, so a paused moment shows only what had
// arrived by then. A new located item gets a one-off pulse and the camera eases toward it.
//
// Pins are MapLibre markers whose element is a real <button> (hover, click, keyboard focus, labels), like the
// cluster rings. Areas are a GeoJSON source with a hatch pattern, so they drape over the terrain.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { KIND_ICON } from '@/components/timeline/icons'
import { KIND_LABEL, PIN_KINDS, areaPolygon, cardText, focusPoint, visibleAt } from '@/lib/evidence'
import { toLngLat, toLonLat } from '@/lib/geo'
import { useStore } from '@/store'
import { history } from '@/stream/history'
import { easeToPoint } from './camera'
import { whyLitIds } from '@/lib/whySelect'
import type { Evidence, EvidenceKind, WithId } from '@/types'

const SOURCE_ID = 'evidence-areas'
const HATCH = 'ow-hatch'
const NEW_PULSE_MS = 3000

function iconSvg(kind: EvidenceKind): string {
  return renderToStaticMarkup(createElement(KIND_ICON[kind], { size: kind === 'favourite_place' ? 11 : 14, strokeWidth: 2.2, 'aria-hidden': true }))
}

class PinMarker {
  readonly el: HTMLButtonElement
  private readonly marker: Marker
  private kind: EvidenceKind

  constructor(map: MapLibreMap, e: WithId<Evidence>, isNew: boolean, h: { click: (id: string) => void; hover: (id: string | null) => void }) {
    this.kind = e.kind
    this.el = document.createElement('button')
    this.el.type = 'button'
    this.el.className = 'ow-pin'
    this.el.dataset.evidenceId = e.id
    const body = document.createElement('span')
    body.className = 'ow-pin__body'
    body.innerHTML = iconSvg(e.kind)
    this.el.appendChild(body)
    if (isNew) {
      this.el.classList.add('ow-pin--new')
      this.el.addEventListener('animationend', () => this.el.classList.remove('ow-pin--new'), { once: true })
      setTimeout(() => this.el.classList.remove('ow-pin--new'), NEW_PULSE_MS)
    }
    // A click here must not also count as a click on the map behind.
    this.el.addEventListener('click', (ev) => { ev.stopPropagation(); h.click(e.id) })
    this.el.addEventListener('mouseenter', () => h.hover(e.id))
    this.el.addEventListener('mouseleave', () => h.hover(null))
    this.el.addEventListener('focus', () => h.hover(e.id))
    this.el.addEventListener('blur', () => h.hover(null))
    const p = e.location as NonNullable<Evidence['location']>
    // Evidence marks are information, not scene objects: never fade them when terrain covers them.
    this.marker = new Marker({ element: this.el, anchor: 'center', opacityWhenCovered: 1 }).setLngLat(toLngLat(p)).addTo(map)
  }

  update(e: WithId<Evidence>, selected: boolean, hovered: boolean): void {
    if (e.kind !== this.kind) {
      // A note became a sighting: the same mark, now with the right icon.
      this.kind = e.kind
      ;(this.el.firstElementChild as HTMLElement).innerHTML = iconSvg(e.kind)
    }
    if (e.location) this.marker.setLngLat(toLngLat(e.location))
    this.el.dataset.kind = e.kind
    this.el.dataset.selected = String(selected)
    this.el.dataset.hover = String(hovered)
    this.el.setAttribute('aria-pressed', String(selected))
    this.el.setAttribute('aria-label', `${KIND_LABEL[e.kind]}: ${cardText(e)}`)
  }

  remove(): void {
    this.marker.remove()
  }
}

/** Diagonal hatch for "covered" areas, drawn once. Warm-white lines on transparent. */
function hatchImage(): ImageData {
  const c = document.createElement('canvas')
  c.width = 16
  c.height = 16
  const g = c.getContext('2d') as CanvasRenderingContext2D
  g.strokeStyle = 'rgba(243, 234, 217, 0.65)'
  g.lineWidth = 1.6
  g.beginPath()
  for (const o of [-16, 0, 16]) {
    g.moveTo(o, 16)
    g.lineTo(o + 16, 0)
  }
  g.stroke()
  return g.getImageData(0, 0, 16, 16)
}

export function watchEvidence(map: MapLibreMap): () => void {
  let disposed = false
  const pins = new Map<string, PinMarker>()
  const eased = new Set<string>()
  let ready = false
  let last = { evidence: null as unknown, meta: null as unknown, selected: null as unknown, hovered: null as unknown, mode: '', t: null as unknown, why: '' }
  const whyKey = (s: ReturnType<typeof useStore.getState>): string => { const w = whyLitIds(s); return w ? [...w].join(',') || '-' : '' }

  const onPinClick = (id: string) => {
    const s = useStore.getState()
    s.selectEvidence(s.ui.selectedEvidenceId === id ? null : id)
  }
  const onPinHover = (id: string | null) => useStore.getState().hoverEvidence(id)

  const sync = () => {
    if (disposed) return
    const s = useStore.getState()
    const t = s.replayView?.t ?? null
    if (
      last.evidence === s.evidence && last.meta === s.evidenceMeta && last.selected === s.ui.selectedEvidenceId &&
      last.hovered === s.ui.hoveredEvidenceId && last.mode === s.ui.replay.mode && last.t === t && last.why === whyKey(s)
    ) return
    last = { evidence: s.evidence, meta: s.evidenceMeta, selected: s.ui.selectedEvidenceId, hovered: s.ui.hoveredEvidenceId, mode: s.ui.replay.mode, t, why: whyKey(s) }
    // "Why?" mode (step 37): the pins of the evidence behind the selected cluster are lit, the others step back.
    const lit = whyLitIds(s)

    const replay = { mode: s.ui.replay.mode, t }
    const visible = s.evidence.order.filter((id) => visibleAt(replay, history.firstSeen.get(id)))
    const alive = new Set<string>()
    const features: GeoJSON.Feature[] = []
    let newest: { id: string; e: WithId<Evidence> } | null = null

    for (const id of visible) {
      const e = s.evidence.byId[id]
      const sel = s.ui.selectedEvidenceId === id
      const hov = s.ui.hoveredEvidenceId === id
      if (PIN_KINDS.includes(e.kind) && e.location) {
        alive.add(id)
        const m = s.evidenceMeta[id]
        const existing = pins.get(id)
        const whyState = lit ? (lit.has(id) ? 'lit' : 'dim') : ''
        if (existing) { existing.update(e, sel, hov); existing.el.dataset.why = whyState }
        else {
          const isNew = !!m?.live && Date.now() - m.seenAt < NEW_PULSE_MS
          const pin = new PinMarker(map, e, isNew, { click: onPinClick, hover: onPinHover })
          pin.update(e, sel, hov)
          pin.el.dataset.why = whyState
          pins.set(id, pin)
        }
      }
      const ring = areaPolygon(e)
      if (ring) features.push({ type: 'Feature', properties: { id }, geometry: { type: 'Polygon', coordinates: [ring.map(toLonLat)] } })

      // A live item that has just gained a place: ease the camera toward it, once.
      const m = s.evidenceMeta[id]
      if (m?.live && !eased.has(id) && focusPoint(e)) {
        eased.add(id)
        if (!newest || m.seenAt >= (s.evidenceMeta[newest.id]?.seenAt ?? 0)) newest = { id, e }
      }
    }
    for (const [id, pin] of pins) {
      if (!alive.has(id)) { pin.remove(); pins.delete(id) }
    }

    if (ready) {
      ;(map.getSource(SOURCE_ID) as { setData: (d: GeoJSON.FeatureCollection) => void } | undefined)?.setData({ type: 'FeatureCollection', features })
      const hi = s.ui.selectedEvidenceId ?? s.ui.hoveredEvidenceId
      map.setFilter('evidence-areas-hi', ['==', ['get', 'id'], hi ?? ''])
    }

    // Only while live, and never while the camera is already moving (the officer may be looking elsewhere).
    if (newest && s.ui.replay.mode === 'live' && !map.isMoving()) {
      const p = focusPoint(newest.e)
      if (p) easeToPoint(map, p)
    }
  }

  const init = () => {
    if (disposed) return
    if (!map.hasImage(HATCH)) map.addImage(HATCH, hatchImage(), { pixelRatio: 2 })
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    // Under the 3D buildings (and so under the ghosts): "searched" is background knowledge, not a thing to find.
    const below = map.getLayer('building-3d') ? 'building-3d' : undefined
    map.addLayer({ id: 'evidence-areas-fill', type: 'fill', source: SOURCE_ID, paint: { 'fill-pattern': HATCH, 'fill-opacity': 0.6 } }, below)
    map.addLayer({ id: 'evidence-areas-line', type: 'line', source: SOURCE_ID, paint: { 'line-color': '#f3ead9', 'line-opacity': 0.5, 'line-width': 1.2, 'line-dasharray': [3, 2] } }, below)
    map.addLayer({ id: 'evidence-areas-hi', type: 'line', source: SOURCE_ID, filter: ['==', ['get', 'id'], ''], paint: { 'line-color': '#ffb224', 'line-width': 2.5 } }, below)
    ready = true
    last = { evidence: null, meta: null, selected: null, hovered: null, mode: '', t: null, why: '' } // force a redraw into the new source
    sync()
  }
  if (map.loaded()) init()
  else map.once('load', init)

  sync()
  const unsub = useStore.subscribe(sync)

  // Clicking empty map or pressing Esc clears the selection (not while picking a last-seen point).
  const onMapClick = () => {
    const s = useStore.getState()
    if (!s.ui.panels.newCase && s.ui.selectedEvidenceId) s.selectEvidence(null)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && useStore.getState().ui.selectedEvidenceId) useStore.getState().selectEvidence(null)
  }
  map.on('click', onMapClick)
  window.addEventListener('keydown', onKey)

  return () => {
    disposed = true
    unsub()
    map.off('click', onMapClick)
    window.removeEventListener('keydown', onKey)
    for (const p of pins.values()) p.remove()
    pins.clear()
    try {
      if (ready) {
        for (const id of ['evidence-areas-hi', 'evidence-areas-line', 'evidence-areas-fill']) if (map.getLayer(id)) map.removeLayer(id)
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
        if (map.hasImage(HATCH)) map.removeImage(HATCH)
      }
    } catch { /* the map is already being torn down */ }
  }
}
