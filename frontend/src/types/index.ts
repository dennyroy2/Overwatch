// Friendly aliases over the generated contract types. Everything else in the app
// imports from here, never from './api' directly. Do not hand-write contract types.
import type { components } from './api'

type S = components['schemas']

export type GeoPoint = S['GeoPoint']
export type SubjectProfile = S['SubjectProfile']
export type Evidence = S['Evidence']
export type Cluster = S['Cluster']
export type GhostFrame = S['GhostFrame']
export type TaskingRequest = S['TaskingRequest']
export type Decision = S['Decision']
export type LogEntry = S['LogEntry']
export type FoundEvent = S['FoundEvent']
export type Report = S['Report']

export type GhostsMsg = S['GhostsMsg']
export type EvidenceMsg = S['EvidenceMsg']
export type TaskingMsg = S['TaskingMsg']
export type LogMsg = S['LogMsg']
export type FoundMsg = S['FoundMsg']

/** The WebSocket envelope, discriminated on `type`. */
export type StreamMessage = GhostsMsg | EvidenceMsg | TaskingMsg | LogMsg | FoundMsg

export type EvidenceKind = Evidence['kind']
export type EvidenceSource = Evidence['source']
export type RequestStatus = NonNullable<TaskingRequest['status']>
