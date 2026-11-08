// Cluster rings and percentages on the map (step 17). Each cluster is a MapLibre Marker whose element is a
// real <button>: native hover, click and keyboard focus, crisp monospace text, and it follows the terrain.
// Built with plain DOM and updated outside React (clusters change 5 times a second).
//
// Identity: the backend names clusters by rank, so we track them by place (lib/clusters.ts). A ring keeps
// its marker, and glides to its new centre instead of jumping, when ranks swap. The three most probable
// clusters get a percentage label; selection follows the place (store.selectCluster).
import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { ClusterTracker, ringDiameterPx, topIndices, type Track } from '@/lib/clusters'
import { distanceMetres, lerpPoint, toLngLat } from '@/lib/geo'
import { whyFor } from '@/lib/whySelect'
import { frameRoute } from './camera'
import { selectDisplayedClusters, useStore } from '@/store'
import type { Cluster, GeoPoint } from '@/types'

/** How quickly a ring glides toward its newest centre (time constant, ms). */
const GLIDE_MS = 250
const LABELLED = 3
/** Evidence farther than this from its cluster makes "Why?" mode frame them together; closer, the camera stays where it is. */
const WHY_FRAME_M = 250

class ClusterMarker {
  readonly el: HTMLButtonElement
  private readonly label: HTMLSpanElement
  private readonly marker: Marker
  private shown: GeoPoint
  private target: GeoPoint
  track: Track

  constructor(map: MapLibreMap, track: Track, onClick: (m: ClusterMarker) => void) {
    this.track = track
    this.shown = track.center
    this.target = track.center
    this.el = document.createElement('button')
    this.el.type = 'button'
    this.el.className = 'ow-cluster'
    const ring = document.createElement('span')
    ring.className = 'ow-cluster__ring'
    const pulse = document.createElement('span')
    pulse.className = 'ow-cluster__pulse'
    this.label = document.createElement('span')
    this.label.className = 'ow-cluster__label'
    this.el.append(ring, pulse, this.label)
    // Stop the click here: it must not also count as a click on the map behind (which clears the selection).
    this.el.addEventListener('click', (e) => { e.stopPropagation(); onClick(this) })
    // Rings are information, not objects in the scene: never fade them when terrain or a building covers them.
    this.marker = new Marker({ element: this.el, anchor: 'center', opacityWhenCovered: 1 }).setLngLat(toLngLat(track.center)).addTo(map)
  }

  update(track: Track, labelled: boolean, selected: boolean): void {
    this.track = track
    this.target = track.center
    const px = ringDiameterPx(track.probability)
    this.el.style.width = `${px}px`
    this.el.style.height = `${px}px`
    const pct = Math.round(track.probability * 100)
    this.label.textContent = `${pct}%`
    this.label.style.display = labelled ? '' : 'none'
    this.el.setAttribute('aria-pressed', String(selected))
    this.el.setAttribute('aria-label', `Cluster holding ${pct} percent of the remaining probability${selected ? ', selected' : ''}`)
  }

  /** Glide toward the target; returns true while still moving. */
  glide(dtMs: number): boolean {
    if (distanceMetres(this.shown, this.target) < 0.5) return false
    this.shown = lerpPoint(this.shown, this.target, 1 - Math.exp(-dtMs / GLIDE_MS))
    this.marker.setLngLat(toLngLat(this.shown))
    return true
  }

  remove(): void {
    this.marker.remove()
  }
}

export function watchClusters(map: MapLibreMap): () => void {
  const tracker = new ClusterTracker()
  const markers = new Map<number, ClusterMarker>()
  let lastClusters: readonly Cluster[] | null = null
  let lastSelected: string | null = null

  const onMarkerClick = (m: ClusterMarker) => {
    const s = useStore.getState()
    const cluster = selectDisplayedClusters(s).find((c) => c.id === m.track.clusterId) ?? null
    // Clicking the selected cluster again clears the selection.
    s.selectCluster(cluster && s.ui.selectedClusterId === cluster.id ? null : cluster)
    enterWhy()
  }

  /** "Why?" mode (step 37) starts with the click: show the evidence rail, and frame the cluster with its evidence if they are spread out. */
  const enterWhy = () => {
    const s = useStore.getState()
    const why = whyFor(s)
    if (!why || why.items.length === 0 || s.ui.replay.mode !== 'live') return
    if (!s.ui.panels.left) s.setPanel('left', true)
    const places = why.items.flatMap((i) => (i.place ? [i.place] : []))
    if (places.length === 0) return
    const span = Math.max(...places.map((p) => distanceMetres(why.cluster.center, p)))
    // Leave room on the left for the story card (about 26 rem wide), so no arc ends underneath it.
    if (span >= WHY_FRAME_M) frameRoute(map, [why.cluster.center, ...places], { top: 110, bottom: 220, left: 400 + 440, right: 400 })
  }

  const sync = () => {
    const state = useStore.getState()
    const clusters = selectDisplayedClusters(state)
    const ui = state.ui
    if (clusters === lastClusters && ui.selectedClusterId === lastSelected) return
    lastClusters = clusters
    lastSelected = ui.selectedClusterId
    const tracks = tracker.update(clusters)
    const labelled = new Set(topIndices(tracks, LABELLED))
    const alive = new Set<number>()
    tracks.forEach((t, i) => {
      alive.add(t.key)
      const selected = t.clusterId === ui.selectedClusterId
      const existing = markers.get(t.key)
      if (existing) existing.update(t, labelled.has(i), selected)
      else {
        const m = new ClusterMarker(map, t, onMarkerClick)
        m.update(t, labelled.has(i), selected)
        markers.set(t.key, m)
      }
    })
    for (const [key, m] of markers) {
      if (!alive.has(key)) { m.remove(); markers.delete(key) }
    }
  }
  sync()
  const unsub = useStore.subscribe(sync)

  // Gliding runs on animation frames, outside React.
  let raf = 0
  let last = performance.now()
  const loop = (now: number) => {
    const dt = Math.min(100, now - last)
    last = now
    for (const m of markers.values()) m.glide(dt)
    raf = requestAnimationFrame(loop)
  }
  raf = requestAnimationFrame(loop)

  // Clicking empty map, or pressing Escape, clears the selection (not while picking a last-seen point).
  const onMapClick = () => {
    const s = useStore.getState()
    if (!s.ui.panels.newCase && s.ui.selectedClusterId) s.selectCluster(null)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && useStore.getState().ui.selectedClusterId) useStore.getState().selectCluster(null)
  }
  map.on('click', onMapClick)
  window.addEventListener('keydown', onKey)

  return () => {
    cancelAnimationFrame(raf)
    unsub()
    map.off('click', onMapClick)
    window.removeEventListener('keydown', onKey)
    for (const m of markers.values()) m.remove()
    markers.clear()
    tracker.reset()
  }
}
