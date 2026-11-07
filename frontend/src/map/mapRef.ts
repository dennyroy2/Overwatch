// The live MapLibre instance, for code that needs it outside the MapView component
// (the deck.gl overlay in step 11, camera helpers, dev tooling).
import type { Map as MapLibreMap } from 'maplibre-gl'

let current: MapLibreMap | null = null
export const getMap = (): MapLibreMap | null => current
export function setMap(map: MapLibreMap | null): void {
  current = map
  // Dev-only handle for the browser console and automated checks.
  if (import.meta.env.DEV) (window as unknown as { __map?: MapLibreMap | null }).__map = map
}
