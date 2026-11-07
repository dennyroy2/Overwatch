import type { SubjectProfile } from '@/types'

/** The fictional demo case. No real person's data (product guardrail). last_seen is left to the server default (124 St & Jasper Ave). */
export function demoCase(): SubjectProfile {
  return {
    name: 'Margaret (fictional)',
    age: 79,
    condition: 'dementia',
    mobility: 'low',
    clothing: ['blue puffer jacket', 'grey pants'],
    notes: 'Fictional demo case. Last seen near 124 St and Jasper Ave.',
    last_seen_time: new Date().toISOString(),
  }
}
