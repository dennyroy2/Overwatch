// Throwaway route: /styleguide. Shows every token so the direction can be judged and
// contrast verified on the darkest surface. Safe to delete once the real UI exists.
import { Bus, Check, Drone, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { contrast, tokens, type TokenName } from '@/lib/tokens'

const surfaces: { name: string; token: TokenName; cls: string }[] = [
  { name: 'Ground (map land)', token: 'bg0', cls: 'bg-ground' },
  { name: 'Panel', token: 'bg1', cls: 'bg-panel' },
  { name: 'Raised', token: 'bg2', cls: 'bg-raised' },
  { name: 'Control', token: 'bg3', cls: 'bg-control' },
]
const inks: { name: string; token: TokenName; role: string }[] = [
  { name: 'Text 1', token: 'text1', role: 'Primary text' },
  { name: 'Text 2', token: 'text2', role: 'Secondary text' },
  { name: 'Text 3', token: 'text3', role: 'Tertiary, metadata' },
  { name: 'Amber', token: 'amber', role: 'Human action, selection, probability' },
  { name: 'Cyan', token: 'cyan', role: 'Anything the AI says' },
  { name: 'Danger', token: 'danger', role: 'Rejected, failed, unsafe' },
  { name: 'Success', token: 'success', role: 'Constraint met, confirmed' },
]
const scale = [
  ['text-2xl', '28', 'Case name'],
  ['text-xl', '20', 'Panel title'],
  ['text-lg', '16', 'Card title'],
  ['text-md', '14', 'Emphasis'],
  ['text-base', '13', 'Default interface text'],
  ['text-sm', '12', 'Secondary detail'],
  ['text-xs', '11', 'Timestamps, units'],
] as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="mb-4 text-xl font-semibold text-ink">{title}</h2>
      {children}
    </section>
  )
}

export default function Styleguide() {
  const dark = tokens.bg0
  return (
    <div className="bg-grid min-h-full">
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-ink">Overwatch styleguide</h1>
        <p className="mt-2 max-w-[60ch] text-ink-2">
          Amber is the single accent and marks human decisions and probability. Cyan marks only what the AI
          says. Numbers are monospace and tabular so they never jitter as they update.
        </p>

        <Section title="Surfaces">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {surfaces.map((s) => (
              <div key={s.token} className={`${s.cls} rounded-md border border-line-strong p-3`}>
                <div className="text-base text-ink">{s.name}</div>
                <div className="font-mono text-xs text-ink-3">{tokens[s.token]}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Colour and contrast on the darkest surface">
          <div className="overflow-hidden rounded-md border border-line bg-ground">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-line text-left text-sm text-ink-2">
                  <th className="p-3 font-medium">Token</th>
                  <th className="p-3 font-medium">Role</th>
                  <th className="p-3 text-right font-medium">Hex</th>
                  <th className="p-3 text-right font-medium">Contrast</th>
                  <th className="p-3 font-medium">AA</th>
                </tr>
              </thead>
              <tbody>
                {inks.map((c) => {
                  const ratio = contrast(tokens[c.token], dark)
                  const pass = ratio >= 4.5
                  return (
                    <tr key={c.token} className="border-b border-line last:border-0">
                      <td className="p-3">
                        <span className="flex items-center gap-2">
                          <span className="size-3 rounded-sm" style={{ background: tokens[c.token] }} />
                          <span style={{ color: tokens[c.token] }}>{c.name}</span>
                        </span>
                      </td>
                      <td className="p-3 text-ink-2">{c.role}</td>
                      <td className="p-3 text-right font-mono text-ink-2">{tokens[c.token]}</td>
                      <td className="p-3 text-right font-mono text-ink">{ratio.toFixed(1)}:1</td>
                      <td className="p-3">
                        {pass ? <Check className="size-4 text-success" aria-label="Pass" /> : <X className="size-4 text-danger" aria-label="Fail" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Type">
          <div className="rounded-md border border-line bg-panel p-4">
            <div className="grid gap-3">
              {scale.map(([cls, px, use]) => (
                <div key={cls} className="flex items-baseline gap-4">
                  <span className="w-28 shrink-0 font-mono text-xs text-ink-3">{cls} · {px}px</span>
                  <span className={`${cls} text-ink`}>{use}</span>
                </div>
              ))}
              <div className="flex items-baseline gap-4 border-t border-line pt-3">
                <span className="w-28 shrink-0 font-mono text-xs text-ink-3">mono · tabular</span>
                <span className="font-mono text-md text-ink">53.5422, -113.5337 · 12:04:31 · 23%</span>
              </div>
            </div>
          </div>
        </Section>

        <Section title="Radius, depth and motion">
          <div className="flex flex-wrap items-center gap-4">
            {(['sm', 'md', 'lg'] as const).map((r) => (
              <div key={r} className={`rounded-${r} border border-line-strong bg-raised px-4 py-3 font-mono text-sm text-ink-2`}>
                radius-{r}
              </div>
            ))}
            <div className="rounded-lg bg-raised px-4 py-3 text-sm text-ink-2 shadow-panel">shadow-panel</div>
            <div className="font-mono text-sm text-ink-3">
              fast 120ms · base 220ms · slow 420ms · camera 3000ms · camera-short 1500ms · ease-out expo
            </div>
          </div>
        </Section>

        <Section title="Sample cards">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Evidence card: AI-parsed summary is cyan, facts are neutral */}
            <article className="rounded-md border border-line bg-panel p-3 shadow-panel">
              <div className="flex items-center gap-2 text-ink-2">
                <Bus className="size-4" aria-hidden />
                <span className="text-sm font-medium text-ink">Sighting</span>
                <span className="ml-auto font-mono text-xs text-ink-3">12:04</span>
              </div>
              <p className="mt-2 text-md text-ai">
                <Sparkles className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
                Woman in a blue jacket got off near the river valley stop.
              </p>
              <p className="mt-1 text-sm text-ink-2">Bus driver · transit · entered 12:06</p>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-sm bg-control" role="meter" aria-label="Reliability" aria-valuenow={75} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full w-3/4 rounded-sm bg-amber" />
                </div>
                <span className="font-mono text-xs text-ink-2">75%</span>
              </div>
            </article>

            {/* Tasking card: amber is the human decision */}
            <article className="rounded-md border border-line bg-panel p-3 shadow-panel">
              <div className="flex items-center gap-2">
                <Drone className="size-4 text-ink-2" aria-hidden />
                <span className="text-md font-medium text-ink">Drone 2</span>
                <span className="ml-auto font-mono text-xs text-ink-3">12 min</span>
              </div>
              <p className="mt-2 font-mono text-xl text-amber">
                23<span className="text-md text-ink-2">% of remaining probability</span>
              </p>
              <p className="mt-1 text-sm text-ai">Highest-probability area; not yet covered by any search.</p>
              <ul className="mt-2 flex gap-3 text-xs text-ink-2">
                {['Battery', 'Line of sight', 'Airspace', 'Wind'].map((c) => (
                  <li key={c} className="flex items-center gap-1"><Check className="size-3 text-success" aria-hidden />{c}</li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Button size="sm">Approve</Button>
                <Button size="sm" variant="secondary">Edit</Button>
                <Button size="sm" variant="ghost">Reject</Button>
              </div>
            </article>
          </div>
          <p className="mt-3 text-sm text-ink-3">
            Possible match, awaiting officer confirmation. The AI never declares anyone found.
          </p>
        </Section>
      </main>
    </div>
  )
}
