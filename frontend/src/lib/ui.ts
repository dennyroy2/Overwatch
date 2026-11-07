/** m:ss for a duration in ms. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** True when typing into a field: global shortcuts (/, Space) must stay out of the way. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/** HH:MM:SS (24 h) for an ISO string or epoch ms; "--:--:--" when missing or invalid. */
export function clockTime(t: string | number | null | undefined): string {
  if (t === null || t === undefined) return '--:--:--'
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? '--:--:--' : d.toLocaleTimeString('en-CA', { hour12: false })
}
