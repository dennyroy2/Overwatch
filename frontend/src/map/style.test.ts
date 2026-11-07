import { describe, expect, it } from 'vitest'
import snapshot from './positron.snapshot.json'
import { darkenStyle, TERRAIN_EXAGGERATION, type StyleSpec } from './style'

const dark = darkenStyle(snapshot as unknown as StyleSpec)
const ids = dark.layers.map((l) => l.id)
const paintOf = (l: unknown) => (l as { paint: Record<string, unknown> }).paint
const layoutOf = (l: unknown) => (l as { layout: Record<string, unknown> }).layout

describe('darkenStyle', () => {
  it('replaces flat buildings with 3D extrusions', () => {
    expect(ids).not.toContain('building')
    expect(ids).toContain('building-3d')
    const b = dark.layers.find((l) => l.id === 'building-3d')
    expect(b?.type).toBe('fill-extrusion')
  })

  it('draws buildings under road labels and the hillshade under roads', () => {
    expect(ids.indexOf('building-3d')).toBeLessThan(ids.indexOf('highway-name-path'))
    expect(ids.indexOf('hillshade')).toBeLessThan(ids.indexOf('highway_minor'))
  })

  it('adds terrain and uses separate DEM sources for terrain and hillshade', () => {
    expect(dark.terrain?.source).toBe('terrain-dem')
    expect(dark.terrain?.exaggeration).toBe(TERRAIN_EXAGGERATION)
    const hs = dark.layers.find((l) => l.id === 'hillshade')
    expect(hs && 'source' in hs ? hs.source : null).toBe('hillshade-dem')
    expect(dark.sources['terrain-dem']).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' })
    expect(dark.sources['hillshade-dem']).toMatchObject({ type: 'raster-dem', encoding: 'terrarium' })
  })

  it('keeps the valley readable: exaggeration is a deliberate middle value', () => {
    expect(TERRAIN_EXAGGERATION).toBeGreaterThanOrEqual(1.5)
    expect(TERRAIN_EXAGGERATION).toBeLessThanOrEqual(3)
  })

  it('has a dark background and a sky that matches the ground', () => {
    const bg = dark.layers.find((l) => l.type === 'background')
    expect(paintOf(bg)['background-color']).toBe('#0a0e13')
    expect(dark.sky?.['sky-color']).toBe('#0a0e13')
  })

  it('gives every label a dark halo and hides road shields', () => {
    const symbols = dark.layers.filter((x) => x.type === 'symbol')
    const visible = symbols.filter((l) => layoutOf(l).visibility !== 'none')
    expect(visible.length).toBeGreaterThan(10)
    for (const l of visible) expect(paintOf(l)['text-halo-color']).toBe('#06080b')
    const shields = symbols.filter((l) => l.id.includes('shield'))
    expect(shields.length).toBeGreaterThan(0)
    for (const l of shields) expect(layoutOf(l).visibility).toBe('none')
  })

  it('does not mutate the input style', () => {
    expect((snapshot as unknown as StyleSpec).layers.some((l) => l.id === 'building')).toBe(true)
  })
})
