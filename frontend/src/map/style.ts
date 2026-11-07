// Builds the map style: OpenFreeMap's light "positron" style, restyled dark IN CODE so it follows
// the design tokens, plus AWS open terrain, a hillshade, 3D buildings and a sky that fades into
// the ground. No API keys anywhere.
//
// Why fetch live, with a bundled snapshot as fallback: the style JSON references a sprite sheet
// by content hash (ofm_xxxx) that OpenFreeMap rotates, so a stale copy can silently lose its
// icons. Fetching keeps us current; the snapshot keeps the demo from dying if the fetch fails.
import type { MapOptions } from 'maplibre-gl'
import snapshot from './positron.snapshot.json'

export type StyleSpec = Exclude<NonNullable<MapOptions['style']>, string>
type Layer = StyleSpec['layers'][number]

export const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

/**
 * Vertical exaggeration. A taste call: too low and the river valley disappears, too high and
 * downtown becomes a mountain range. Tuned by eye against the valley at low pitch (DECISIONS.md).
 */
export const TERRAIN_EXAGGERATION = 2.0

// Map colours. Hex mirrors src/styles/tokens.css family; the map sits a step darker than panels
// so floating panels separate from it.
const C = {
  land: '#0a0e13',
  residential: '#0c1117',
  park: '#0b1310',
  water: '#04090f',
  waterway: '#0e2230',
  roadPath: '#161d26',
  roadMinor: '#1c2530',
  roadMajor: '#2a3441',
  roadMotorway: '#3a4757',
  casing: '#06080b',
  rail: '#1c2530',
  boundary: '#232c39',
  labelPlace: '#8592a2',
  labelRoad: '#7a8697',
  labelWater: '#6b8fa3',
  halo: '#06080b',
} as const

function demSource(attribution?: string) {
  return {
    type: 'raster-dem' as const,
    tiles: [TERRAIN_TILES],
    encoding: 'terrarium' as const,
    tileSize: 256,
    maxzoom: 15,
    ...(attribution ? { attribution } : {}),
  }
}

function darkenLayer(l: Layer): Layer | null {
  const id = l.id
  const paint = { ...((l as { paint?: Record<string, unknown> }).paint ?? {}) }
  const layout = { ...((l as { layout?: Record<string, unknown> }).layout ?? {}) }
  const set = (k: string, v: unknown) => { paint[k] = v }
  let hide = false

  switch (l.type) {
    case 'background':
      set('background-color', C.land)
      break
    case 'fill': {
      const color =
        id === 'water' ? C.water :
        id === 'park' || id === 'landcover_wood' ? C.park :
        id === 'landuse_residential' ? C.residential :
        id.startsWith('aeroway') ? '#0e141b' :
        id.startsWith('landcover') ? C.land : '#121820'
      set('fill-color', color)
      if ('fill-outline-color' in paint) set('fill-outline-color', color)
      break
    }
    case 'line': {
      const color =
        id.includes('casing') ? C.casing :
        id === 'waterway' ? C.waterway :
        id.startsWith('boundary') ? C.boundary :
        id.startsWith('railway') ? C.rail :
        id.startsWith('aeroway') ? C.roadPath :
        id === 'highway_path' ? C.roadPath :
        id.includes('motorway') ? C.roadMotorway :
        id.includes('major') ? C.roadMajor :
        C.roadMinor
      set('line-color', color)
      break
    }
    case 'symbol': {
      if (id.includes('shield')) { hide = true; break }
      const color =
        id.startsWith('water') || id === 'waterway_line_label' ? C.labelWater :
        id.startsWith('highway-name') ? C.labelRoad : C.labelPlace
      set('text-color', color)
      set('text-halo-color', C.halo)
      set('text-halo-width', 1.5)
      set('text-halo-blur', 0.5)
      // The style's icons are black dots; invisible and ugly on dark, so drop them.
      set('icon-opacity', 0)
      break
    }
    default:
      break
  }
  if (hide) layout.visibility = 'none'
  return { ...l, paint, layout } as Layer
}

export function darkenStyle(base: StyleSpec): StyleSpec {
  const layers: Layer[] = []
  for (const l of base.layers) {
    // Flat building footprints are replaced by 3D extrusions below.
    if (l.id === 'building') continue
    const dark = darkenLayer(l)
    if (!dark) continue
    // Hillshade sits above land/water fills and below waterways and roads.
    if (dark.id === 'waterway') {
      layers.push({
        id: 'hillshade',
        type: 'hillshade',
        source: 'hillshade-dem',
        paint: {
          'hillshade-shadow-color': '#000000',
          'hillshade-highlight-color': '#1b2430',
          'hillshade-accent-color': '#02050a',
          'hillshade-exaggeration': 0.55,
        },
      })
    }
    // 3D buildings go under the first road-name label so labels stay on top.
    if (dark.id === 'highway-name-path') {
      layers.push({
        id: 'building-3d',
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6],
            0, '#131a22', 60, '#19212b', 200, '#27323f'],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.78,
        },
      } as Layer)
    }
    layers.push(dark)
  }

  return {
    ...base,
    sources: {
      ...base.sources,
      'terrain-dem': demSource('Terrain: Mapzen via AWS Open Data'),
      // MapLibre advises separate sources for hillshade and 3D terrain (better rendering quality).
      'hillshade-dem': demSource(),
    },
    terrain: { source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION },
    // Sky and fog match the ground so a pitched camera has no bright horizon band.
    sky: {
      'sky-color': C.land,
      'horizon-color': C.land,
      'fog-color': C.land,
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.4,
      'atmosphere-blend': 0,
    },
    layers,
  }
}

/** Fetch the live style (6 s timeout); fall back to the bundled snapshot. Always returns a dark style. */
export async function loadStyle(): Promise<StyleSpec> {
  try {
    const res = await fetch(STYLE_URL, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) throw new Error(`style ${res.status}`)
    return darkenStyle((await res.json()) as StyleSpec)
  } catch (e) {
    console.warn('OpenFreeMap style fetch failed, using bundled snapshot:', e)
    return darkenStyle(snapshot as unknown as StyleSpec)
  }
}
