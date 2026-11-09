import { ShieldBan } from 'lucide-react'
import { useStore } from '@/store'

/**
 * Police-only mode (field feedback: "if they have a gun, or a history of violence, it's a no-go" for volunteers).
 * Shown for the whole case; the backend also stops requesting volunteer teams.
 */
export function SafetyBanner() {
  const weapon = useStore((s) => s.caseProfile?.weapon_access ?? false)
  const violence = useStore((s) => s.caseProfile?.violence_history ?? false)
  if (!weapon && !violence) return null
  const why = [weapon && 'may have access to a weapon', violence && 'history of violence'].filter(Boolean).join(' and ')
  return (
    <div
      role="alert"
      className="pointer-events-auto absolute left-1/2 top-[4.25rem] z-20 flex -translate-x-1/2 items-center gap-2 rounded-md border border-danger bg-panel px-3 py-1.5 shadow-panel"
      data-testid="safety-banner"
    >
      <ShieldBan className="size-4 text-danger" aria-hidden />
      <span className="text-md font-medium text-danger">Police only</span>
      <span className="text-md text-ink-2">Subject {why}. Volunteers do not approach.</span>
    </div>
  )
}
