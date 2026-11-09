import { useEffect, useId, useState } from 'react'
import { ChevronLeft, ChevronRight, ClipboardPlus, LocateFixed, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { openDemo } from '@/lib/openDemo'
import { EDMONTON_CENTRE, formatPoint } from '@/lib/geo'
import { flyToArea } from '@/map/camera'
import { getMap } from '@/map/mapRef'
import { useStore } from '@/store'
import { openCase } from '@/stream/client'
import type { SubjectProfile } from '@/types'

type Condition = SubjectProfile['condition']
type Mobility = SubjectProfile['mobility']

const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'dementia', label: 'Dementia' },
  { value: 'child', label: 'Child' },
  { value: 'hiker', label: 'Hiker' },
  { value: 'mental_health', label: 'Mental health' },
  { value: 'other', label: 'Other' },
]
const MOBILITY: { value: Mobility; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

/** Value for <input type="datetime-local"> in the user's own time zone. */
function localInputValue(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm text-ink-2">{label}</Label>
      {children}
      {error && <p id={`${id}-error`} className="text-sm text-danger">{error}</p>}
    </div>
  )
}

/**
 * Collects a case and calls openCase(). The last-seen point is REQUIRED and has no default: the
 * whole simulation starts from it, so it must never be assumed by accident. "Load demo case"
 * supplies its own point (124 St & Jasper Ave), so the demo stays one click.
 * The form is draft input only; nothing here is backend state (hard rule 3).
 */
export function NewCaseSheet() {
  const uid = useId()
  const draftPoint = useStore((s) => s.ui.draftLastSeen)
  const caseOpen = useStore((s) => s.caseProfile !== null)
  const collapsed = useStore((s) => s.ui.panels.sheetCollapsed)
  const setPanel = useStore((s) => s.setPanel)
  const setDraft = useStore((s) => s.setDraftLastSeen)

  const [name, setName] = useState('')
  const [age, setAge] = useState('')
  const [condition, setCondition] = useState<Condition>('dementia')
  const [mobility, setMobility] = useState<Mobility>('medium')
  const [clothing, setClothing] = useState<string[]>([])
  const [clothingInput, setClothingInput] = useState('')
  const [notes, setNotes] = useState('')
  const [weapon, setWeapon] = useState(false)
  const [violence, setViolence] = useState(false)
  const [time, setTime] = useState(() => localInputValue(new Date()))
  const [submitted, setSubmitted] = useState(false)

  const ageNum = Number(age)
  const errors = {
    name: name.trim() ? undefined : 'Enter a name.',
    age: Number.isInteger(ageNum) && ageNum >= 1 && ageNum <= 120 ? undefined : 'Enter an age from 1 to 120.',
    point: draftPoint ? undefined : 'Click the map to set where they were last seen.',
    time: Number.isNaN(Date.parse(time)) ? 'Enter the time they were last seen.' : undefined,
  }
  const valid = !errors.name && !errors.age && !errors.point && !errors.time

  const close = () => setPanel('newCase', false)
  useEffect(() => {
    if (!caseOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function launch(profile: SubjectProfile) {
    openCase(profile)
    setDraft(null)
    close()
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (!valid || !draftPoint) return
    launch({
      name: name.trim(), age: ageNum, condition, mobility, clothing, notes: notes.trim(),
      last_seen: draftPoint, last_seen_time: new Date(time).toISOString(),
      weapon_access: weapon, violence_history: violence,
    })
  }

  function addClothing() {
    const v = clothingInput.trim()
    if (v && !clothing.includes(v)) setClothing([...clothing, v])
    setClothingInput('')
  }

  const show = (msg?: string) => (submitted ? msg : undefined)
  const ids = { name: `${uid}-name`, age: `${uid}-age`, condition: `${uid}-condition`, clothing: `${uid}-clothing`, notes: `${uid}-notes`, time: `${uid}-time` }

  return (
    <aside
      aria-label="New case"
      className="pointer-events-auto absolute bottom-[var(--ow-dock)] left-3 top-[4.25rem] z-20 overflow-hidden rounded-lg border border-line bg-panel shadow-panel transition-[width] duration-[var(--ow-dur-base)] ease-[var(--ow-ease-out)]"
      style={{ width: collapsed ? '3rem' : 'var(--ow-rail-width)' }}
    >
      {/* Collapsed: a thin strip, like the rails. The map stays clickable, so the last-seen point can still be picked. */}
      {collapsed && (
        <button
          type="button"
          onClick={() => setPanel('sheetCollapsed', false)}
          aria-expanded={false}
          aria-label="Open the new case form"
          className="flex h-full w-full flex-col items-center gap-3 pt-3 text-ink-2 hover:bg-raised hover:text-ink"
        >
          <ChevronRight className="size-4" aria-hidden />
          <ClipboardPlus className="size-5" aria-hidden />
          {draftPoint && <span className="size-2 rounded-full bg-amber" title="Last-seen point picked" aria-hidden />}
        </button>
      )}
      {!collapsed && (
      <div className="flex h-full flex-col" style={{ width: 'var(--ow-rail-width)' }}>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="text-md font-medium text-ink">New case</h2>
        <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setPanel('sheetCollapsed', true)} aria-label="Collapse the new case form" aria-expanded>
          <ChevronLeft />
        </Button>
        {caseOpen && (
          <Button variant="ghost" size="icon" onClick={close} aria-label="Close new case">
            <X />
          </Button>
        )}
      </div>

      <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {caseOpen && (
            <p className="text-sm text-ink-2">Opening a new case replaces the one that is open now.</p>
          )}

          <Field id={ids.name} label="Name" error={show(errors.name)}>
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off"
              aria-invalid={!!show(errors.name)} aria-describedby={show(errors.name) ? `${ids.name}-error` : undefined} />
          </Field>

          <div className="grid grid-cols-[6rem_1fr] gap-3">
            <Field id={ids.age} label="Age" error={show(errors.age)}>
              <Input id={ids.age} inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)}
                className="font-mono" aria-invalid={!!show(errors.age)} aria-describedby={show(errors.age) ? `${ids.age}-error` : undefined} />
            </Field>
            <Field id={ids.condition} label="Condition">
              <select
                id={ids.condition}
                value={condition}
                onChange={(e) => setCondition(e.target.value as Condition)}
                className="h-8 w-full rounded-lg border border-input bg-input/30 px-2 text-base text-ink outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {CONDITIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Field>
          </div>

          <div className="flex flex-col gap-1.5">
            <span id={`${uid}-mob`} className="text-sm text-ink-2">Mobility</span>
            <div role="radiogroup" aria-labelledby={`${uid}-mob`} className="grid grid-cols-3 gap-1.5">
              {MOBILITY.map((m) => {
                const on = mobility === m.value
                return (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setMobility(m.value)}
                    className={cn(
                      'h-8 rounded-md border text-base transition-colors',
                      on ? 'border-amber bg-amber-wash text-amber' : 'border-line-strong bg-control text-ink-2 hover:text-ink',
                    )}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
          </div>

          <Field id={ids.clothing} label="Clothing">
            <Input
              id={ids.clothing}
              value={clothingInput}
              onChange={(e) => setClothingInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addClothing() } }}
              onBlur={addClothing}
              placeholder="grey hooded jacket, then Enter"
              autoComplete="off"
            />
            {clothing.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {clothing.map((c) => (
                  <li key={c} className="flex items-center gap-1 rounded-sm bg-raised py-0.5 pl-2 pr-0.5 text-sm text-ink">
                    {c}
                    <button type="button" onClick={() => setClothing(clothing.filter((x) => x !== c))}
                      aria-label={`Remove ${c}`} className="grid size-5 place-items-center rounded-sm text-ink-3 hover:text-ink">
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>

          <Field id={ids.notes} label="Notes">
            <Textarea id={ids.notes} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm text-ink-2">Safety</legend>
            {[
              { on: weapon, set: setWeapon, label: 'May have access to a weapon' },
              { on: violence, set: setViolence, label: 'History of violence' },
            ].map((o) => (
              <label key={o.label} className="flex items-center gap-2 text-base text-ink">
                <input type="checkbox" checked={o.on} onChange={(e) => o.set(e.target.checked)} className="size-4 accent-[var(--ow-danger)]" />
                {o.label}
              </label>
            ))}
            {(weapon || violence) && (
              <p className="text-sm text-danger">Police-only mode: volunteer teams will not be requested.</p>
            )}
          </fieldset>

          <div className="flex flex-col gap-1.5" aria-live="polite">
            <span className="text-sm text-ink-2">Last seen</span>
            <div className={cn(
              'rounded-md border px-3 py-2',
              draftPoint ? 'border-amber bg-amber-wash' : show(errors.point) ? 'border-danger' : 'border-line-strong',
            )}>
              {draftPoint ? (
                <p className="font-mono text-md text-ink">{formatPoint(draftPoint)}</p>
              ) : (
                <p className={cn('text-base', show(errors.point) ? 'text-danger' : 'text-ink-2')}>
                  Click the map to set where they were last seen.
                </p>
              )}
              <Button type="button" variant="ghost" size="sm" className="mt-1.5 -ml-1.5"
                onClick={() => { const m = getMap(); if (m) flyToArea(m, EDMONTON_CENTRE, 11.5) }}>
                <LocateFixed data-icon="inline-start" />
                Centre map on Edmonton
              </Button>
            </div>
          </div>

          <Field id={ids.time} label="Time last seen" error={show(errors.time)}>
            <Input id={ids.time} type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} className="font-mono" />
          </Field>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-line p-3">
          <Button type="button" variant="secondary" onClick={() => { openDemo(); setDraft(null) }}>Load demo case</Button>
          <Button type="submit" className="ml-auto" aria-disabled={submitted && !valid}>Open case</Button>
        </div>
      </form>
      </div>
      )}
    </aside>
  )
}
