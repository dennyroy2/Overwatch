// "Why?" mode on the map (step 37): the map dims, and cyan arcs grow from the selected cluster to every piece of
// evidence the engine says is behind it. Cyan is the AI's colour in this design, and this is the engine explaining
// itself. Drawn by the same deck.gl overlay as the ghosts: a scrim after the ghosts (so labels stay readable above it),
// then the arcs on top. The evidence pins and the cluster rings are DOM markers, so they stay bright above everything.
import { ArcLayer, ScatterplotLayer, SolidPolygonLayer } from '@deck.gl/layers'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { toLngLat, toLonLat } from '@/lib/geo'
import { tokens } from '@/lib/tokens'
import { arcProgress, arcsDoneAt, scrimProgress } from '@/lib/why'
import { whyFor } from '@/lib/whySelect'
import { hexToLinear, srgbToLinear } from '@/stream/smoother'
import { useStore } from '@/store'
import type { GeoPoint } from '@/types'

/** How dark the scrim is at full: enough to push the swarm back without hiding the streets. */
const SCRIM_ALPHA = 0.55
const CYAN = hexToLinear(tokens.cyan)
const SCRIM_RGB = [6, 8, 11].map(srgbToLinear) as [number, number, number]
const WORLD: [number, number][] = [[-180, -85], [180, -85], [180, 85], [-180, 85]]
/** Arcs and dots sit this far above the ground, so they are never buried in it. */
const LIFT_M = 12

type P3 = [number, number, number]

interface View {
  seq: number
  enteredAt: number
  from: P3
  targets: { id: string; to: P3 }[]
  /** The arc data, rebuilt only while arcs are still growing (or when the places change). */
  data: { from: P3; to: P3; at: P3 }[]
  builtAt: number
}

let view: View | null = null

export function watchWhy(map: MapLibreMap): () => void {
  const lift = (p: GeoPoint): P3 => {
    let z = 0
    try { z = map.queryTerrainElevation(toLngLat(p)) ?? 0 } catch { z = 0 }
    const [lon, lat] = toLonLat(p)
    return [lon, lat, z + LIFT_M]
  }
  const sync = () => {
    const s = useStore.getState()
    const why = whyFor(s)
    if (!why || s.ui.replay.mode !== 'live') { view = null; return }
    const from = lift(why.cluster.center)
    const targets = why.items.filter((i) => i.place).map((i) => ({ id: i.id, to: lift(i.place as GeoPoint) }))
    const seq = s.ui.whySeq
    if (!view || view.seq !== seq) view = { seq, enteredAt: performance.now(), from, targets, data: [], builtAt: -1 }
    else {
      // The same view carries on: the cluster drifts and evidence may arrive, but the animation does not restart.
      view.from = from
      view.targets = targets
      view.builtAt = -1
    }
  }
  sync()
  const unsub = useStore.subscribe(sync)
  return () => {
    unsub()
    view = null
  }
}

const lerp3 = (a: P3, b: P3, k: number): P3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** The layers for this frame (none when "Why?" mode is off). `now` is the animation clock, ms. */
export function whyLayers(now: number, beforeId: string): (SolidPolygonLayer | ArcLayer | ScatterplotLayer)[] {
  const v = view
  if (!v) return []
  const age = now - v.enteredAt
  const drawing = age < arcsDoneAt(v.targets.length) + 50
  // Rebuild the arc data while arcs grow; once they are all drawn, keep the same array so deck.gl has nothing to redo.
  if (drawing || v.builtAt < 0) {
    v.data = v.targets.map((t, i) => ({ from: v.from, to: t.to, at: lerp3(v.from, t.to, arcProgress(age, i)) }))
    v.builtAt = now
  }
  const common = { beforeId, pickable: false, parameters: { depthCompare: 'always', depthWriteEnabled: false } } as const
  const layers: (SolidPolygonLayer | ArcLayer | ScatterplotLayer)[] = [
    new SolidPolygonLayer({
      ...common,
      id: 'why-scrim',
      data: [{ polygon: WORLD }],
      getPolygon: (d: { polygon: [number, number][] }) => d.polygon,
      getFillColor: [...SCRIM_RGB, Math.round(255 * SCRIM_ALPHA * scrimProgress(age))],
      filled: true,
    }),
  ]
  if (v.data.length > 0) {
    layers.push(
      new ArcLayer({
        ...common,
        id: 'why-arcs',
        data: v.data,
        getSourcePosition: (d: { from: P3 }) => d.from,
        getTargetPosition: (d: { at: P3 }) => d.at,
        getSourceColor: [...CYAN, 235],
        getTargetColor: [...CYAN, 235],
        getHeight: 0.45,
        getWidth: 3,
        widthUnits: 'pixels',
        updateTriggers: { getTargetPosition: drawing ? Math.floor(age / 16) : -1 },
      }),
      // A dot where each arc lands, once it has arrived.
      new ScatterplotLayer({
        ...common,
        id: 'why-ends',
        data: v.targets.map((t, i) => ({ at: t.to, k: arcProgress(age, i) })).filter((d) => d.k >= 1),
        getPosition: (d: { at: P3 }) => d.at,
        getFillColor: [...CYAN, 255],
        getRadius: 6,
        radiusUnits: 'pixels',
        updateTriggers: { getPosition: drawing ? Math.floor(age / 16) : -1 },
      }),
    )
  }
  return layers
}
