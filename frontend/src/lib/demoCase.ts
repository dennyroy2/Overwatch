import { DEMO_LAST_SEEN } from '@/lib/geo'
import type { SubjectProfile } from '@/types'

/** The fictional demo case. No real person's data (product guardrail). Sets its own last-seen point, since the New case sheet requires one. */
export function demoCase(): SubjectProfile {
  return {
    name: 'Margaret (fictional)',
    age: 79,
    condition: 'dementia',
    mobility: 'low',
    clothing: ['grey hooded jacket', 'dark track pants with white side stripes', 'dark sneakers'], // as in scenario/margaret.json
    notes: 'Fictional demo case. Last seen near 124 St and Jasper Ave.',
    last_seen: DEMO_LAST_SEEN,
    last_seen_time: new Date().toISOString(),
  }
}
