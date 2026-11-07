// Approve / Edit / Reject (step 22), as pure functions plus the one POST.
//
// The screen never decides by itself (hard rule 3): a click sends POST /decision and the card changes when the
// STREAM confirms it, either the request arriving again with a new `status`, or the log entry the backend writes
// for every decision (`<asset>: <status> (<reason>)`). Until then the card shows a pending spinner, and if the
// POST fails the click is rolled back and an error toast says why.
import { API_URL } from '@/lib/config'
import type { Decision, LogEntry, TaskingRequest } from '@/types'

/** The signed-in officer. There is no login in the demo, so this is the fictional case's officer (decided with the user). */
export const OFFICER = 'Officer Lee'

/** Assets an officer can swap to when editing. The backend has no asset list yet, so these are the demo's. */
export const ASSETS = ['Drone 1', 'Drone 2', 'Ground Team 1', 'Ground Team 2', 'Ground Team 3'] as const

export type Choice = 'approved' | 'rejected'
export type RequestState = 'pending' | 'sending' | Choice

/** A decision this screen has sent and is waiting to see confirmed. `baseline` is how long the log was when it was sent. */
export interface InFlight {
  choice: Choice
  baseline: number
}

export const approveBody = (r: Pick<TaskingRequest, 'id'>): Decision => ({ request_id: r.id ?? '', approved: true, officer: OFFICER })

/** Reject needs a reason (one line). Returns null when it is empty so the caller keeps the button off. */
export function rejectBody(r: Pick<TaskingRequest, 'id'>, reason: string): Decision | null {
  const why = reason.replace(/\s+/g, ' ').trim()
  return why ? { request_id: r.id ?? '', approved: false, reason: why, officer: OFFICER } : null
}

/** The contract has no edit fields yet (ask #2), so an edit travels as text in the approval's reason. */
export function editReason(from: string, to: string, note = ''): string {
  const n = note.replace(/\s+/g, ' ').trim()
  return `Edited: ${to} instead of ${from}${n ? `. ${n}` : ''}`
}

export function editBody(r: Pick<TaskingRequest, 'id' | 'asset'>, to: string, note = ''): Decision | null {
  if (!to || to === r.asset) return null
  return { request_id: r.id ?? '', approved: true, reason: editReason(r.asset, to, note), officer: OFFICER }
}

export class DecisionError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function sendDecision(body: Decision, fetchImpl: typeof fetch = fetch): Promise<void> {
  let res: Response
  try {
    res = await fetchImpl(`${API_URL}/decision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    throw new DecisionError('Could not reach the server', 0)
  }
  if (!res.ok) throw new DecisionError(res.status === 404 ? 'That request no longer exists on the server' : `The server refused it (${res.status})`, res.status)
}

/** The choice the backend logged for this asset since `baseline`, if it has logged one. */
export function confirmedChoice(log: readonly LogEntry[], asset: string, baseline: number): Choice | null {
  for (let i = log.length - 1; i >= Math.max(0, baseline); i--) {
    const e = log[i]
    if (e.action !== 'decision') continue
    if (e.detail.startsWith(`${asset}: approved`)) return 'approved'
    if (e.detail.startsWith(`${asset}: rejected`)) return 'rejected'
  }
  return null
}

/**
 * What the card shows. The stream's `status` wins; otherwise the log entry the backend wrote for this decision;
 * otherwise "sending" while our POST is outstanding; otherwise pending. A click alone never changes the answer.
 */
export function requestState(r: Pick<TaskingRequest, 'asset' | 'status'>, log: readonly LogEntry[], inflight?: InFlight): RequestState {
  if (r.status === 'approved' || r.status === 'rejected') return r.status
  if (!inflight) return 'pending'
  return confirmedChoice(log, r.asset, inflight.baseline) ?? 'sending'
}
