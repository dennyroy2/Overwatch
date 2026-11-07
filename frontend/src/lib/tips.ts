// Sending an officer's tip (step 20): build the note, POST it. The screen NEVER adds the card itself (hard
// rule 3): the backend echoes the evidence over the stream and the card appears from there.
//
// Agreed tip flow: POST /evidence { kind: "note", source: "officer", raw_text: <exactly what was typed or
// said>, no location, time }. The backend's agent later re-sends it structured with the SAME id; the store
// upserts, so the card fills in.
import { API_URL } from '@/lib/config'
import type { Evidence } from '@/types'

/** Longest summary line we send (the contract wants "one line, human readable"). */
export const SUMMARY_MAX = 160

/** Only the fields a new note needs; everything else takes the backend's defaults. Derived from the generated type. */
export type NewNote = Pick<Evidence, 'case_id' | 'kind' | 'source' | 'time' | 'summary' | 'raw_text'>

/** One line: whitespace collapsed, shortened with an ellipsis. `raw_text` keeps the exact words. */
export function summarize(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= SUMMARY_MAX ? one : `${one.slice(0, SUMMARY_MAX - 1).trimEnd()}…`
}

/**
 * The note to send. `timeMs` is the moment the tip is about: the CURRENT SIMULATION time while a case runs
 * (the simulation clock runs far faster than the wall clock, so wall-clock "now" would land in the
 * engine's distant past), or the wall clock when there is none.
 */
export function buildNote(caseId: string, text: string, timeMs: number): NewNote {
  const raw = text.trim()
  return {
    case_id: caseId,
    kind: 'note',
    source: 'officer',
    time: new Date(timeMs).toISOString(),
    summary: summarize(raw),
    raw_text: raw,
  }
}

export class TipError extends Error {
  /** HTTP status, or 0 when the request never reached the server. */
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** POST the note. Resolves to the saved evidence; throws a `TipError` the UI can explain. */
export async function sendTip(note: NewNote, fetchImpl: typeof fetch = fetch): Promise<Evidence> {
  let res: Response
  try {
    res = await fetchImpl(`${API_URL}/evidence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note),
    })
  } catch {
    throw new TipError('Could not reach the server', 0)
  }
  if (!res.ok) throw new TipError(res.status === 404 ? 'That case is no longer open on the server' : `The server refused the tip (${res.status})`, res.status)
  return (await res.json()) as Evidence
}
