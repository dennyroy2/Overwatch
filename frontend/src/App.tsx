import { AppShell } from '@/components/shell/AppShell'
import Styleguide from '@/routes/Styleguide'

/** Placeholder until the 3D map lands (step 10). Grid marks the empty canvas. */
function MapPlaceholder() {
  return (
    <div className="bg-grid grid h-full w-full place-items-center">
      <p className="text-base text-ink-3">Map area</p>
    </div>
  )
}

export default function App() {
  // Throwaway path-based switch; the real app has no router.
  if (window.location.pathname === '/styleguide') return <Styleguide />
  // Dev review: /?review=pip,report,collapsed,pending previews the closed-by-default slots.
  const review = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('review') ?? '' : ''
  return (
    <AppShell
      map={<MapPlaceholder />}
      initial={{ pip: review.includes('pip'), report: review.includes('report'), collapsed: review.includes('collapsed'), pending: review.includes('pending') ? 2 : 0 }}
    />
  )
}
