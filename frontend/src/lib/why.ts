// "Why?" mode (step 37): what the screen shows when the officer clicks a cluster and asks why the swarm is there.
// Pure functions, so every choice can be tested. The screen shows what the engine says and nothing more: the story is
// the cluster's own `story` (never invented; "Story pending" while it is missing), and the evidence behind it is the
// cluster's own `evidence_ids`, as the store knows them. The engine decides which evidence belongs to a cluster
// (the located evidence close to its centre); this does not second-guess it.
import { focusPoint } from '@/lib/evidence'
import type { Cluster, Evidence, GeoPoint, WithId } from '@/types'

export interface WhyItem {
  id: string
  evidence: WithId<Evidence>
  /** Where the arc ends: the evidence's place, or null if it has none (then it is listed but no arc is drawn). */
  place: GeoPoint | null
}

export interface WhyView {
  cluster: Cluster
  /** The cluster's own story, or null while there is none: the card then says "Story pending". */
  story: string | null
  /** The evidence behind the cluster, in the order the engine lists it (oldest first, as the timeline orders them). */
  items: WhyItem[]
  /** Ids the engine lists that this screen does not have (yet): counted, never guessed at. */
  missing: number
}

export function buildWhy(
  cluster: Cluster | null,
  byId: Readonly<Record<string, WithId<Evidence>>>,
  order: readonly string[],
  visible: (id: string) => boolean = () => true,
): WhyView | null {
  if (!cluster) return null
  const wanted = new Set(cluster.evidence_ids ?? [])
  const items: WhyItem[] = []
  for (const id of order) {
    if (!wanted.has(id) || !visible(id)) continue
    const e = byId[id]
    if (e) items.push({ id, evidence: e, place: focusPoint(e) })
  }
  const story = cluster.story?.trim() || null
  return { cluster, story, items, missing: wanted.size - items.length }
}

// ---------------------------------------------------------------- the typing effect
/** Characters per second the story types out at: a 200-character story takes about 3 seconds. */
export const TYPE_CPS = 60

/** How many characters are showing `elapsedMs` after the story began to type. 0 under reduced motion means "all at once". */
export function typedLength(elapsedMs: number, total: number, cps = TYPE_CPS): number {
  if (total <= 0) return 0
  if (cps <= 0) return total
  return Math.min(total, Math.max(0, Math.floor((elapsedMs / 1000) * cps)))
}

// ---------------------------------------------------------------- the arcs
export const ARC_GROW_MS = 700
export const ARC_STAGGER_MS = 160
/** The scrim that dims the map eases in over this long. */
export const SCRIM_FADE_MS = 300

/** How far along (0..1) arc number `index` is `ageMs` after the mode was entered: each starts a little after the one before. */
export function arcProgress(ageMs: number, index: number, growMs = ARC_GROW_MS, staggerMs = ARC_STAGGER_MS): number {
  const t = (ageMs - index * staggerMs) / growMs
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 1 - (1 - t) * (1 - t) * (1 - t) // ease-out: the arc leaps out, then settles at its end
}

export const scrimProgress = (ageMs: number): number => Math.min(1, Math.max(0, ageMs / SCRIM_FADE_MS))

/** Every arc is done at this age; after it nothing needs redrawing each frame. */
export const arcsDoneAt = (arcs: number): number => (arcs <= 0 ? 0 : ARC_GROW_MS + (arcs - 1) * ARC_STAGGER_MS)
