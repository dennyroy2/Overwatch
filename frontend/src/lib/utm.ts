// UTM on WGS84, the way search teams read coordinates (CalTopo's readout: "12U 0291922E 5699445N").
// Same formulas as backend/engine/utm.py, so the screen and the reports always agree.
const A = 6378137.0
const F = 1 / 298.257223563
const E2 = F * (2 - F)
const EP2 = E2 / (1 - E2)
const K0 = 0.9996
const BANDS = 'CDEFGHJKLMNPQRSTUVWXX'

export function utmZone(lon: number, lat: number): number {
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32
  return Math.min(Math.max(Math.floor((lon + 180) / 6) + 1, 1), 60)
}

export function toUtm(lon: number, lat: number): { zone: number; band: string; east: number; north: number } {
  const zone = utmZone(lon, lat)
  const lon0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180
  const phi = (lat * Math.PI) / 180
  const lam = (lon * Math.PI) / 180
  const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2)
  const t = Math.tan(phi) ** 2
  const c = EP2 * Math.cos(phi) ** 2
  const a = Math.cos(phi) * (lam - lon0)
  const e4 = E2 * E2
  const e6 = e4 * E2
  const m = A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi))
  const east = K0 * n * (a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120) + 500000
  let north = K0 * (m + n * Math.tan(phi) * ((a * a) / 2 + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
    + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720))
  if (lat < 0) north += 10000000
  const band = BANDS[Math.floor((Math.min(Math.max(lat, -80), 83.999) + 80) / 8)]
  return { zone, band, east, north }
}

/** "12U 0332116E 5935574N" (7-digit easting, truncated to the metre, as CalTopo shows it). */
export function utmString(lon: number, lat: number): string {
  const { zone, band, east, north } = toUtm(lon, lat)
  return `${zone}${band} ${String(Math.floor(east)).padStart(7, '0')}E ${String(Math.floor(north)).padStart(7, '0')}N`
}
