import { gainPercent } from '@/lib/tasking'

const SIZE = 56
const STROKE = 5
const R = (SIZE - STROKE) / 2
const C = 2 * Math.PI * R
const SWEEP = 0.75 // a three-quarter ring, open at the bottom

/** The expected-gain gauge: a three-quarter arc filled in amber with the percentage in the middle (mono). */
export function GainArc({ gain }: { gain: number }) {
  const pct = gainPercent({ expected_gain: gain })
  const track = C * SWEEP
  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }} role="meter" aria-label="Expected gain" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-[225deg]" aria-hidden>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-control" strokeDasharray={`${track} ${C}`} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" strokeWidth={STROKE} strokeLinecap="round" className="stroke-amber transition-[stroke-dasharray] duration-[var(--ow-dur-slow,500ms)]"
          strokeDasharray={`${(track * pct) / 100} ${C}`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-mono text-md font-medium text-ink">{pct}%</span>
    </div>
  )
}
