import { MapView } from '@/components/map/MapView'
import { AppShell } from '@/components/shell/AppShell'
import Styleguide from '@/routes/Styleguide'
import { attachCase } from '@/stream/client'
import { openDemo } from '@/lib/openDemo'
import { useStore } from '@/store'

// Dev-only URL switches, applied once at module load (never inside a component, so React
// StrictMode's double render cannot trigger them twice):
//   ?review=collapsed,pip,report   preview hidden panel states
//   ?autostart=demo | unknown      open the demo case / a case id the server doesn't know
if (import.meta.env.DEV && window.location.pathname !== '/styleguide') {
  ;(window as unknown as Record<string, unknown>).__store = useStore
  const q = new URLSearchParams(window.location.search)
  const review = q.get('review') ?? ''
  const { setPanel } = useStore.getState()
  if (review.includes('collapsed')) { setPanel('left', false); setPanel('right', false) }
  if (review.includes('pip')) setPanel('pip', true)
  if (review.includes('report')) setPanel('report', true)
  const auto = q.get('autostart')
  if (auto === 'demo') openDemo()
  if (auto === 'unknown') { attachCase('case_doesnotexist'); setPanel('newCase', false) }
}

export default function App() {
  // Throwaway path-based switch; the real app has no router.
  if (window.location.pathname === '/styleguide') return <Styleguide />
  return <AppShell map={<MapView />} />
}
