import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { TaskingCard } from './TaskingCard'
import type { Request } from '@/lib/tasking'

const base: Request = {
  id: 'req_1', case_id: 'case_1', asset: 'Task Force 1', kind: 'task_force', utm: '12U 0331906E 5934637N',
  target_area: [{ lat: 53.53, lon: -113.54 }, { lat: 53.531, lon: -113.54 }, { lat: 53.531, lon: -113.539 }],
  route: [], expected_gain: 0.77, duration_min: 19, reasons: ['Very likely'], status: 'pending',
  constraints_ok: { daylight: true },
  checks: [{ name: 'Home, 10150 Groat Rd', kind: 'residential', access: 'Private home: owner consent needed',
    actions: ['Door knock', 'Ask about doorbell cameras'], location: { lat: 53.53, lon: -113.54 },
    utm: '12U 0331883E 5934638N', share: 0.31 }],
  tasks: [],
}

const render = (r: Request) => renderToStaticMarkup(
  <ul><TaskingCard request={r} evidence={[]} hovered={false} sending={false} choice={null} locked={false}
    onHover={() => {}} onShowEvidence={() => {}} onShowArea={() => {}} /></ul>)

describe('TaskingCard field features', () => {
  it('shows UTM and the buildings to check, with access and actions', () => {
    const html = render(base)
    expect(html).toContain('12U 0331906E 5934637N')
    expect(html).toContain('Buildings to check')
    expect(html).toContain('Private home: owner consent needed')
    expect(html).toContain('Door knock · Ask about doorbell cameras')
  })
  it('shows a checklist for first-hour requests and hides flight constraints', () => {
    const html = render({ ...base, asset: 'First-hour checks', kind: 'first_hour', checks: [], constraints_ok: {},
      tasks: ['Send the BOLO to patrol, transit (ETS) and taxi companies'] })
    expect(html).toContain('To do')
    expect(html).toContain('Send the BOLO')
    expect(html).not.toContain('Line of sight')
  })
})
