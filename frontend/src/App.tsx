import Styleguide from '@/routes/Styleguide'

export default function App() {
  // Throwaway path-based switch; the real app has no router.
  if (window.location.pathname === '/styleguide') return <Styleguide />
  return (
    <main className="flex h-full items-center justify-center">
      <p className="font-mono text-sm text-ink-2">OVERWATCH · frontend scaffold</p>
    </main>
  )
}
