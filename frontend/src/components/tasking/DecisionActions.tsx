import { useState } from 'react'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ASSETS, approveBody, editBody, rejectBody, type Choice } from '@/lib/decision'
import { cn } from '@/lib/utils'
import type { Request } from '@/lib/tasking'
import { useDecide } from './useDecide'

type Form = null | 'edit' | 'reject'

const FIELD =
  'h-8 w-full min-w-0 rounded-md border border-line-strong bg-ground px-2.5 text-md text-ink placeholder:text-ink-3 focus-visible:border-amber focus-visible:outline-none'

/**
 * Approve / Edit / Reject for one pending request. Approve is one click. Reject needs a one-line reason. Edit
 * swaps the asset (with an optional note) and goes out as an approval whose reason describes the change, because
 * the contract has no edit fields yet (ask #2). While the POST is outstanding or unconfirmed the row becomes a
 * spinner; the card itself changes only when the stream confirms (see lib/decision.ts).
 */
export function DecisionActions({ request: r, sending, choice, locked }: { request: Request; sending: boolean; choice: Choice | null; locked: boolean }) {
  const decide = useDecide()
  const [form, setForm] = useState<Form>(null)
  const [reason, setReason] = useState('')
  const [asset, setAsset] = useState('')
  const [note, setNote] = useState('')

  if (sending) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5 text-sm text-ink-2" role="status">
        <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
        {choice === 'rejected' ? 'Rejecting' : choice === 'approved' ? 'Approving' : 'Sending'}… waiting for the server to confirm
      </div>
    )
  }

  const options = ASSETS.filter((a) => a !== r.asset)
  const close = () => { setForm(null); setReason(''); setAsset(''); setNote('') }
  const lockTitle = locked ? 'Go live or pause the view to decide' : undefined
  const reject = rejectBody(r, reason)
  const edit = editBody(r, asset, note)
  const esc = (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }

  return (
    <div className="mt-3 border-t border-line pt-2.5">
      <div className="flex gap-1.5" role="group" aria-label={`Decide on ${r.asset}`}>
        <Button size="sm" disabled={locked} title={lockTitle} onClick={() => { close(); void decide(r.asset, approveBody(r)) }} className="flex-1">
          <Check data-icon="inline-start" />
          Approve
        </Button>
        <Button size="sm" variant="secondary" disabled={locked} title={lockTitle} aria-expanded={form === 'edit'} onClick={() => (form === 'edit' ? close() : setForm('edit'))}>
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
        <Button size="sm" variant="secondary" disabled={locked} title={lockTitle} aria-expanded={form === 'reject'} onClick={() => (form === 'reject' ? close() : setForm('reject'))} className={cn(form === 'reject' && 'text-danger')}>
          <X data-icon="inline-start" />
          Reject
        </Button>
      </div>

      {form === 'reject' && (
        <form
          className="mt-2 flex flex-col gap-1.5"
          onSubmit={(e) => { e.preventDefault(); if (reject) void decide(r.asset, reject).then((ok) => ok && close()) }}
          onKeyDown={esc}
        >
          <label htmlFor={`why-${r.id}`} className="text-sm text-ink-2">Why reject this? One line, it goes in the record.</label>
          <input id={`why-${r.id}`} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Already searched by ground team" className={FIELD} />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" variant="destructive" disabled={!reject}>Reject {r.asset}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}

      {form === 'edit' && (
        <form
          className="mt-2 flex flex-col gap-1.5"
          onSubmit={(e) => { e.preventDefault(); if (edit) void decide(r.asset, edit).then((ok) => ok && close()) }}
          onKeyDown={esc}
        >
          <label htmlFor={`asset-${r.id}`} className="text-sm text-ink-2">Send a different asset instead of {r.asset}</label>
          <select id={`asset-${r.id}`} autoFocus value={asset} onChange={(e) => setAsset(e.target.value)} className={FIELD}>
            <option value="">Choose an asset</option>
            {options.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={160} aria-label="Optional note" placeholder="Optional note (why the change)" className={FIELD} />
          <p className="text-xs text-ink-3">Approves the search with this change recorded. The area stays as recommended.</p>
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" disabled={!edit}>Approve with change</Button>
            <Button type="button" size="sm" variant="ghost" onClick={close}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}
