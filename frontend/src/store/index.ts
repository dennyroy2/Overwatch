// The store holds only what changes at human speed. Ghost positions live in
// src/stream/ghostBuffer.ts (typed arrays, outside React).
//
// SOURCE OF TRUTH RULE (hard rule 3): the backend is the only source. Nothing here is ever
// added by a click. Panels POST to the API and the result comes back through the stream, where
// it is UPSERTED BY ID. Add/replace only; never "just append".
import { create } from 'zustand'
import { hasId } from '@/types'
import { resolveSelection } from '@/lib/clusters'
import { requestState, type InFlight, type Choice } from '@/lib/decision'
import type { PlaybackMode } from '@/stream/playback'
import type {
  Cluster, Evidence, FoundEvent, GeoPoint, LogEntry, Report, StreamMessage, SubjectProfile, TaskingRequest, WithId,
} from '@/types'
import type { ConnectionState } from '@/components/shell/types'

export interface ById<T> {
  byId: Record<string, T>
  /** Arrival order (first time an id was seen). A card that changes in place keeps its slot. */
  order: string[]
}

const emptyById = <T,>(): ById<T> => ({ byId: {}, order: [] })

/** Add or replace by id, keeping the original position on replace. Returns a new object. */
export function upsertById<T extends { id: string }>(coll: ById<T>, item: T): ById<T> {
  const exists = item.id in coll.byId
  return {
    byId: { ...coll.byId, [item.id]: item },
    order: exists ? coll.order : [...coll.order, item.id],
  }
}

/** Upsert many with one state update. Later duplicates of an id win (ask #11 fallback). */
export function upsertMany<T extends { id: string }>(coll: ById<T>, items: T[]): ById<T> {
  const byId = { ...coll.byId }
  const order = [...coll.order]
  for (const item of items) {
    if (!(item.id in byId)) order.push(item.id)
    byId[item.id] = item
  }
  return { byId, order }
}

export const logKey = (e: LogEntry): string => `${e.time}|${e.actor}|${e.action}|${e.detail}`

export interface Toast {
  id: number
  tone: 'error' | 'info'
  text: string
}

export interface UiState {
  selectedClusterId: string | null
  /**
   * Where the selected cluster is. The backend names clusters by rank, so the id can change under us; the
   * selection follows this PLACE and re-resolves the id each frame (lib/clusters.ts).
   */
  selectedPlace: GeoPoint | null
  /** The evidence card / map mark the officer clicked, and the one they are hovering (either side highlights the other). */
  selectedEvidenceId: string | null
  hoveredEvidenceId: string | null
  /** The tasking request the pointer is on (its target area is outlined on the map). */
  hoveredRequestId: string | null
  /** live, paused (a frozen picture) or playing back a recording (step 38). Position lives in stream/playback.ts. */
  replay: { mode: PlaybackMode }
  panels: { left: boolean; right: boolean; report: boolean; pip: boolean; newCase: boolean; sheetCollapsed: boolean }
  /** Last-seen point picked on the map while the New case sheet is open. Draft input, not backend data. */
  draftLastSeen: GeoPoint | null
  /** "why" mode etc. (step 37). */
  modes: { why: boolean }
}

export interface ReplayView {
  /** History time of the replayed moment, ms since the case's first frame. */
  t: number
  clusters: readonly Cluster[]
  /** Simulation time at the replayed moment, ms since the Unix epoch. */
  simTime: number | null
  alive: number | null
}

export interface ConnectionInfo {
  state: ConnectionState
  /** Failed attempts since the last good connection. */
  attempt: number
}

export interface StoreState {
  caseProfile: SubjectProfile | null
  connection: ConnectionInfo
  evidence: ById<WithId<Evidence>>
  /** When this screen first saw each evidence id (the card's "entered" time) and whether it arrived live or from the hydrate snapshot. Not backend data. */
  evidenceMeta: Record<string, { seenAt: number; live: boolean }>
  requests: ById<WithId<TaskingRequest>>
  /** Decisions THIS screen has sent and is waiting to see confirmed by the stream. Bookkeeping only; the answer comes from the stream. */
  decisions: Record<string, InFlight>
  /** Short messages shown over the map (errors, mostly). */
  toasts: Toast[]
  log: LogEntry[]
  logKeys: Record<string, true>
  clusters: Cluster[]
  ghostMeta: { t: string | null; aliveFraction: number | null }
  /** What the recording shows while paused or replaying (null when live). Never backend data: derived from it. */
  replayView: ReplayView | null
  found: FoundEvent | null
  ui: UiState

  setCaseProfile: (p: SubjectProfile | null) => void
  setConnection: (state: ConnectionState, attempt?: number) => void
  /** Route one stream message. Ghost positions are NOT handled here (see client.ts). */
  applyMessage: (msg: Exclude<StreamMessage, { type: 'ghosts' }>) => void
  applyGhostMeta: (t: string, aliveFraction: number, clusters: Cluster[]) => void
  /** Merge a GET /report snapshot (upsert, never replace). */
  hydrate: (r: Report) => void
  /** Clear everything derived from the backend (new case, or the server lost the case). */
  resetCaseData: () => void
  setUi: (patch: Partial<Omit<UiState, 'panels' | 'modes'>>) => void
  setDraftLastSeen: (p: GeoPoint | null) => void
  setReplayMode: (mode: PlaybackMode) => void
  selectEvidence: (id: string | null) => void
  hoverEvidence: (id: string | null) => void
  hoverRequest: (id: string | null) => void
  /** Remember that a decision was just sent (the card shows a spinner until the stream confirms it). */
  beginDecision: (requestId: string, choice: Choice) => void
  endDecision: (requestId: string) => void
  pushToast: (tone: Toast['tone'], text: string) => void
  dismissToast: (id: number) => void
  setReplayView: (v: ReplayView | null) => void
  /** Select a cluster (remembering its place) or clear the selection with null. */
  selectCluster: (c: Cluster | null) => void
  setPanel: (panel: keyof UiState['panels'], open: boolean) => void
}

const initialUi = (): UiState => ({
  selectedClusterId: null,
  selectedPlace: null,
  selectedEvidenceId: null,
  hoveredEvidenceId: null,
  hoveredRequestId: null,
  replay: { mode: 'live' },
  panels: { left: true, right: true, report: false, pip: false, newCase: true, sheetCollapsed: false },
  draftLastSeen: null,
  modes: { why: false },
})

let toastSeq = 0

const caseData = () => ({
  evidence: emptyById<WithId<Evidence>>(),
  evidenceMeta: {} as Record<string, { seenAt: number; live: boolean }>,
  requests: emptyById<WithId<TaskingRequest>>(),
  decisions: {} as Record<string, InFlight>,
  log: [] as LogEntry[],
  logKeys: {} as Record<string, true>,
  clusters: [] as Cluster[],
  ghostMeta: { t: null as string | null, aliveFraction: null as number | null },
  replayView: null as ReplayView | null,
  found: null as FoundEvent | null,
})

function addLog(s: Pick<StoreState, 'log' | 'logKeys'>, entries: LogEntry[]) {
  let log = s.log
  let logKeys = s.logKeys
  for (const e of entries) {
    const k = logKey(e)
    if (k in logKeys) continue
    if (log === s.log) { log = [...log]; logKeys = { ...logKeys } }
    log.push(e)
    logKeys[k] = true
  }
  return { log, logKeys }
}

export const useStore = create<StoreState>()((set) => ({
  caseProfile: null,
  connection: { state: 'idle', attempt: 0 },
  ...caseData(),
  toasts: [],
  ui: initialUi(),

  setCaseProfile: (caseProfile) => set({ caseProfile }),
  setConnection: (state, attempt = 0) => set({ connection: { state, attempt } }),

  applyMessage: (msg) =>
    set((s) => {
      switch (msg.type) {
        case 'evidence': {
          if (!hasId(msg.data)) return {}
          const id = msg.data.id
          return {
            evidence: upsertById(s.evidence, msg.data),
            evidenceMeta: id in s.evidenceMeta ? s.evidenceMeta : { ...s.evidenceMeta, [id]: { seenAt: Date.now(), live: true } },
          }
        }
        case 'tasking':
          if (!hasId(msg.data)) return {}
          return { requests: upsertById(s.requests, msg.data) }
        case 'log':
          return addLog(s, [msg.data])
        case 'found':
          return { found: msg.data }
        default: {
          const unreachable: never = msg
          return unreachable
        }
      }
    }),

  applyGhostMeta: (t, aliveFraction, clusters) =>
    set((s) => {
      // Re-resolve the selection against this frame: follow the place, not the id.
      const sel = resolveSelection(clusters, s.ui.selectedPlace)
      const keep = s.ui.selectedPlace === null
      return {
        ghostMeta: { t, aliveFraction },
        clusters,
        ui: keep
          ? s.ui
          : { ...s.ui, selectedClusterId: sel ? sel.id : null, selectedPlace: sel ? sel.center : null },
      }
    }),

  hydrate: (r) =>
    set((s) => ({
      caseProfile: r.case,
      evidenceMeta: r.evidence.filter(hasId).reduce(
        (m, e) => (e.id in m ? m : { ...m, [e.id]: { seenAt: Date.now(), live: false } }),
        s.evidenceMeta,
      ),
      evidence: upsertMany(s.evidence, r.evidence.filter(hasId)),
      requests: upsertMany(s.requests, r.requests.filter(hasId)),
      ...addLog(s, r.log),
    })),

  // Panels are deliberately kept: a server restart mid-search must not pop the New case sheet open.
  resetCaseData: () => set((s) => ({ ...caseData(), ui: { ...initialUi(), panels: s.ui.panels } })),

  setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),
  selectEvidence: (id) => set((s) => ({ ui: { ...s.ui, selectedEvidenceId: id } })),
  hoverEvidence: (id) => set((s) => (s.ui.hoveredEvidenceId === id ? s : { ui: { ...s.ui, hoveredEvidenceId: id } })),
  beginDecision: (requestId, choice) => set((s) => ({ decisions: { ...s.decisions, [requestId]: { choice, baseline: s.log.length } } })),
  endDecision: (requestId) => set((s) => {
    if (!(requestId in s.decisions)) return s
    const { [requestId]: _gone, ...rest } = s.decisions
    return { decisions: rest }
  }),
  pushToast: (tone, text) => set((s) => ({ toasts: [...s.toasts.slice(-3), { id: ++toastSeq, tone, text }] })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  hoverRequest: (id) => set((s) => (s.ui.hoveredRequestId === id ? s : { ui: { ...s.ui, hoveredRequestId: id } })),
  setReplayMode: (mode) => set((s) => ({ ui: { ...s.ui, replay: { mode } } })),
  setReplayView: (replayView) => set({ replayView }),
  selectCluster: (c) =>
    set((s) => ({ ui: { ...s.ui, selectedClusterId: c ? c.id : null, selectedPlace: c ? c.center : null } })),
  setDraftLastSeen: (draftLastSeen) => set((s) => ({ ui: { ...s.ui, draftLastSeen } })),
  setPanel: (panel, open) => set((s) => ({ ui: { ...s.ui, panels: { ...s.ui.panels, [panel]: open } } })),
}))

/** Number of requests waiting on the officer (a decision still unconfirmed counts as waiting). */
export const selectPendingCount = (s: StoreState): number =>
  s.requests.order.reduce((n, id) => {
    const st = requestState(s.requests.byId[id], s.log, s.decisions[id])
    return n + (st === 'pending' || st === 'sending' ? 1 : 0)
  }, 0)

/** The clusters to draw: the recorded moment while paused or replaying, the live ones otherwise. */
export const selectDisplayedClusters = (s: StoreState): readonly Cluster[] =>
  s.ui.replay.mode !== 'live' && s.replayView ? s.replayView.clusters : s.clusters
