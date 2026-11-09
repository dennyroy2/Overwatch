import { useEffect, useRef, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/config'
import { useStore } from '@/store'

/**
 * Field feedback: "it has to fit the tools we already use, not be a whole new thing." Hands the map to CalTopo
 * (GeoJSON) and ATAK / Google Earth (KML), and copies the BOLO bulletin for patrol, transit and building staff.
 */
export function ExportMenu() {
  const caseId = useStore((s) => s.caseProfile?.case_id ?? null)
  const toast = useStore((s) => s.pushToast)
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  if (!caseId) return null
  const base = `${API_URL}/case/${encodeURIComponent(caseId)}`

  async function copyBolo() {
    setOpen(false)
    try {
      const res = await fetch(`${base}/bolo`)
      if (!res.ok) throw new Error(String(res.status))
      const { text } = (await res.json()) as { text: string }
      await navigator.clipboard.writeText(text)
      toast('info', 'BOLO copied: paste it to patrol, transit and building staff.')
    } catch {
      toast('error', 'Could not get the BOLO from the server.')
    }
  }

  const item = 'block w-full rounded-sm px-2 py-1.5 text-left text-base text-ink hover:bg-raised'
  return (
    <div ref={root} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Download data-icon="inline-start" />
        Export
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-64 rounded-md border border-line bg-panel p-1 shadow-panel" role="menu">
          <a role="menuitem" className={item} href={`${base}/export.geojson`} download onClick={() => setOpen(false)}>
            Map for CalTopo <span className="text-sm text-ink-3">(GeoJSON)</span>
          </a>
          <a role="menuitem" className={item} href={`${base}/export.kml`} download onClick={() => setOpen(false)}>
            Map for ATAK / Google Earth <span className="text-sm text-ink-3">(KML)</span>
          </a>
          <button role="menuitem" type="button" className={item} onClick={copyBolo}>
            Copy BOLO bulletin
          </button>
        </div>
      )}
    </div>
  )
}
