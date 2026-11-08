import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Info, TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore, type Toast } from '@/store'

const SHOW_MS = 7000

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useStore((s) => s.dismissToast)
  const reduced = useReducedMotion()
  useEffect(() => {
    const t = setTimeout(() => dismiss(toast.id), toast.tone === 'error' ? SHOW_MS + 3000 : SHOW_MS)
    return () => clearTimeout(t)
  }, [toast.id, toast.tone, dismiss])
  const error = toast.tone === 'error'
  const Icon = error ? TriangleAlert : Info
  return (
    <motion.div
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduced ? undefined : { opacity: 0, y: 8 }}
      transition={{ duration: reduced ? 0 : 0.22 }}
      role={error ? 'alert' : 'status'}
      className={cn('pointer-events-auto flex max-w-[34rem] items-start gap-2 rounded-lg border bg-panel px-3 py-2.5 text-md text-ink shadow-panel', error ? 'border-danger' : 'border-line-strong')}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', error ? 'text-danger' : 'text-ink-2')} aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">{toast.text}</p>
      <button type="button" onClick={() => dismiss(toast.id)} aria-label="Dismiss" className="grid size-5 shrink-0 place-items-center rounded-sm text-ink-3 hover:text-ink">
        <X className="size-3.5" aria-hidden />
      </button>
    </motion.div>
  )
}

/** Short messages over the map, above the time bar and tip box. Errors stay a little longer and are announced. */
export function Toaster() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--ow-dock)+0.75rem)] z-30 flex flex-col items-center gap-2 px-3">
      <AnimatePresence>{toasts.map((t) => <ToastItem key={t.id} toast={t} />)}</AnimatePresence>
    </div>
  )
}
