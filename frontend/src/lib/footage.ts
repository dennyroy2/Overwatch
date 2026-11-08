// Drone footage (step 34): reading the files perception writes (`manifest.json`, `<clip>.detections.json`, schema 1,
// see frontend/DECISIONS.md, step 32) and the pure maths the drone feed needs. The screen never invents a detection:
// it draws what the sidecar says, and which moment to show is decided by the evidence the STREAM delivers.
import { asGeoPoint, distanceMetres } from '@/lib/geo'
import type { Evidence, GeoPoint } from '@/types'

export interface ClipEntry {
  id: string
  video: string
  sidecar: string
  asset: string | null
  width: number
  height: number
  duration_s: number
  /** Where on the map the footage was shot (the mean of the flight route). */
  placement: GeoPoint
}

export type Box = [number, number, number, number] // x1, y1, x2, y2, each 0-1 across and down the video frame

export interface FootageDetection {
  frame: number
  time_s: number
  box: Box
  /** "person", or the clothing phrase that matched. */
  label: string
  confidence: number
  matched: boolean
  clue: string | null
  clue_score: number
  /** Calibrated reliability: set on matched boxes and on boxes that became evidence. */
  reliability: number | null
  location: GeoPoint | null
  radius_m: number | null
  kind: 'clue' | 'sighting' | null
  /** Set only on a detection that became evidence; it equals that Evidence's `id`. */
  evidence_id: string | null
}

export interface FootageFrame {
  index: number
  time_s: number
  drone: GeoPoint & { alt_m: number; heading_deg: number }
}

export interface Sidecar {
  clip: string
  asset: string | null
  width: number
  height: number
  duration_s: number
  fps_sampled: number
  frames: FootageFrame[]
  detections: FootageDetection[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** The clips in a manifest. Anything that is not a manifest (a missing file served as a web page, say) gives none. */
export function parseManifest(raw: unknown): ClipEntry[] {
  const list = (raw as { clips?: unknown } | null)?.clips
  if (!Array.isArray(list)) return []
  const out: ClipEntry[] = []
  for (const c of list as Record<string, unknown>[]) {
    const placement = asGeoPoint(c?.placement)
    const id = str(c?.id), video = str(c?.video), sidecar = str(c?.sidecar)
    const width = num(c?.width), height = num(c?.height), duration = num(c?.duration_s)
    if (!placement || !id || !video || !sidecar || width === null || height === null || duration === null) continue
    out.push({ id, video, sidecar, asset: str(c.asset), width, height, duration_s: duration, placement })
  }
  return out
}

function parseBox(v: unknown): Box | null {
  if (!Array.isArray(v) || v.length !== 4) return null
  const n = v.map(num)
  return n.every((x) => x !== null) ? (n as Box) : null
}

/** A sidecar, or null if it is not a schema-1 sidecar. Detections that are malformed are dropped, never guessed. */
export function parseSidecar(raw: unknown): Sidecar | null {
  const d = raw as Record<string, unknown> | null
  if (!d || d.schema !== 1 || !Array.isArray(d.frames) || !Array.isArray(d.detections)) return null
  const width = num(d.width), height = num(d.height), duration = num(d.duration_s), fps = num(d.fps_sampled)
  if (width === null || height === null || duration === null || fps === null || fps <= 0) return null
  const frames: FootageFrame[] = []
  for (const f of d.frames as Record<string, unknown>[]) {
    const drone = asGeoPoint(f?.drone)
    const index = num(f?.index), time = num(f?.time_s)
    const dr = f?.drone as Record<string, unknown> | undefined
    const alt = num(dr?.alt_m), heading = num(dr?.heading_deg)
    if (drone && index !== null && time !== null && alt !== null && heading !== null) frames.push({ index, time_s: time, drone: { ...drone, alt_m: alt, heading_deg: heading } })
  }
  const detections: FootageDetection[] = []
  for (const x of d.detections as Record<string, unknown>[]) {
    const box = parseBox(x?.box)
    const frame = num(x?.frame), time = num(x?.time_s), conf = num(x?.confidence)
    if (!box || frame === null || time === null || conf === null) continue
    const kind = x.kind === 'clue' || x.kind === 'sighting' ? x.kind : null
    detections.push({
      frame, time_s: time, box, label: str(x.label) ?? 'person', confidence: conf, matched: x.matched === true,
      clue: str(x.clue), clue_score: num(x.clue_score) ?? 0, reliability: num(x.reliability),
      location: asGeoPoint(x.location), radius_m: num(x.radius_m), kind, evidence_id: str(x.evidence_id),
    })
  }
  return { clip: str(d.clip) ?? '', asset: str(d.asset), width, height, duration_s: duration, fps_sampled: fps, frames, detections }
}

/** The clip shot nearest to a place (the request's target area), or the first clip when there is no place. */
export function pickClip(clips: readonly ClipEntry[], target: GeoPoint | null): ClipEntry | null {
  if (clips.length === 0) return null
  if (!target) return clips[0]
  return clips.reduce((best, c) => (distanceMetres(c.placement, target) < distanceMetres(best.placement, target) ? c : best))
}

/** The sampled frame nearest `t` seconds, if one lies within three quarters of a sample spacing (else the box is stale). */
export function frameAt(doc: Pick<Sidecar, 'frames' | 'fps_sampled'>, t: number): FootageFrame | null {
  let best: FootageFrame | null = null
  for (const f of doc.frames) if (best === null || Math.abs(f.time_s - t) < Math.abs(best.time_s - t)) best = f
  return best && Math.abs(best.time_s - t) <= 0.75 / doc.fps_sampled ? best : null
}

/** The boxes to draw at video time `t`: those of the nearest sampled frame, none if the video is between samples. */
export function detectionsAt(doc: Sidecar, t: number): FootageDetection[] {
  const f = frameAt(doc, t)
  return f ? doc.detections.filter((d) => d.frame === f.index) : []
}

/**
 * The detection a streamed drone clue stands for. The id is the same on both sides (precompute makes the evidence
 * id), so that is tried first. A drone clue with another id (one a person wrote by hand) falls back to the evidence
 * detection nearest its place, then to the best clothing match in the clip; with neither, nothing is held.
 */
export function matchEvidence(doc: Pick<Sidecar, 'detections'>, ev: Pick<Evidence, 'id'> & { location?: GeoPoint | null }): FootageDetection | null {
  const exact = doc.detections.find((d) => d.evidence_id !== null && d.evidence_id === ev.id)
  if (exact) return exact
  const sent = doc.detections.filter((d) => d.kind !== null && d.location)
  if (ev.location && sent.length > 0) {
    const here = ev.location
    return sent.reduce((best, d) => (distanceMetres(d.location as GeoPoint, here) < distanceMetres(best.location as GeoPoint, here) ? d : best))
  }
  const matched = doc.detections.filter((d) => d.matched)
  return matched.length > 0 ? matched.reduce((best, d) => (d.clue_score > best.clue_score ? d : best)) : null
}

/** "grey hooded jacket · 90%" for a clothing match, null for a plain person box. */
export function boxLabel(d: Pick<FootageDetection, 'matched' | 'clue' | 'reliability' | 'clue_score'>): string | null {
  if (!d.matched || !d.clue) return null
  return `${d.clue} · ${Math.round((d.reliability ?? d.clue_score) * 100)}%`
}

export const isDroneAsset = (asset: string): boolean => /^drone\b/i.test(asset.trim())

export interface Rect { x: number; y: number; w: number; h: number }

/** Where the video picture sits inside a `boxW` x `boxH` element showing it with `object-fit: contain`. */
export function containRect(boxW: number, boxH: number, videoW: number, videoH: number): Rect {
  if (boxW <= 0 || boxH <= 0 || videoW <= 0 || videoH <= 0) return { x: 0, y: 0, w: Math.max(0, boxW), h: Math.max(0, boxH) }
  const scale = Math.min(boxW / videoW, boxH / videoH)
  const w = videoW * scale, h = videoH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/** A normalised box as pixels inside the picture's rectangle. */
export function boxToRect(picture: Rect, box: Box): Rect {
  const [x1, y1, x2, y2] = box
  return { x: picture.x + x1 * picture.w, y: picture.y + y1 * picture.h, w: (x2 - x1) * picture.w, h: (y2 - y1) * picture.h }
}

// ---------------------------------------------------------------- loading (cached; a miss is a value, not an exception)
const cache = new Map<string, Promise<unknown>>()

/** For tests, and so a refetch is possible after the files were added. */
export function resetFootageCache(): void {
  cache.clear()
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<unknown> {
  const hit = cache.get(url)
  if (hit) return hit
  const p = (async () => {
    try {
      const res = await fetchImpl(url)
      if (!res.ok) return null
      return await res.json() // a missing file may come back as a web page: that fails here and counts as missing
    } catch {
      return null
    }
  })()
  cache.set(url, p)
  return p
}

// Footage files are served by the frontend itself (frontend/public/footage), so "/footage/x.json" is relative to this site.
export async function loadManifest(fetchImpl: typeof fetch = fetch): Promise<ClipEntry[]> {
  return parseManifest(await getJson('/footage/manifest.json', fetchImpl))
}

export async function loadSidecar(clip: ClipEntry, fetchImpl: typeof fetch = fetch): Promise<Sidecar | null> {
  return parseSidecar(await getJson(clip.sidecar, fetchImpl))
}
