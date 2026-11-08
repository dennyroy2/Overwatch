// Closing the search (step 24). "Close search" is the ONE action that ends a search, and only the officer's press
// counts: the AI never declares anyone found (hard rule 8). The body is the generated `CloseSearch` type.
//
// The screen posts, then shows (hard rule 3): nothing is added to the log or marked closed locally. "Closed" is
// derived from the stream's `search_closed` log entry (or the same entry in GET /report).
import { API_URL } from '@/lib/config'
import { OFFICER } from '@/lib/officer'
import type { CloseSearch, FoundEvent, LogEntry } from '@/types'

/** found = true only when the officer states the subject was located. The note is optional (the generated type wants a string, so empty means none). */
export function closeBody(found: boolean, note = ''): CloseSearch {
  const n = note.replace(/\s+/g, ' ').trim()
  return { found, officer: OFFICER, note: n }
}

export class CloseError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function sendClose(caseId: string, body: CloseSearch, fetchImpl: typeof fetch = fetch): Promise<void> {
  let res: Response
  try {
    res = await fetchImpl(`${API_URL}/case/${encodeURIComponent(caseId)}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new CloseError('Could not reach the server', 0)
  }
  if (!res.ok) throw new CloseError(res.status === 404 ? 'That case is no longer open on the server' : `The server refused it (${res.status})`, res.status)
}

/** How the search ended, read from the log: null while it is still open. */
export function closedOutcome(log: readonly LogEntry[]): null | 'located' | 'not_located' {
  if (!log.some((e) => e.action === 'search_closed')) return null
  return log.some((e) => e.action === 'found_confirmed') ? 'located' : 'not_located'
}

/** Identifies one "possible match" so dismissing it does not hide a later, different one. */
export const foundKey = (f: FoundEvent | null): string | null => (f ? JSON.stringify([f.evidence_id ?? null, f.location]) : null)
