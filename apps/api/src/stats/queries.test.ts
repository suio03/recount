import { describe, expect, it, vi } from 'vitest'
import type { Site } from '../db/schema'
import { visitorFunnelSql } from './paths'
import { inRange, type Scope, sessions } from './queries'

// Only the SQL is checked; the client would need a database configured.
vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))
vi.mock('../db/postgres', () => ({ db: {} }))

const scope: Scope = {
  site: { id: '00000000-0000-0000-0000-000000000000', timezone: 'UTC' } as Site,
  range: { from: '2026-10-01', to: '2026-10-14' },
  filters: { goal: 'Pricing' },
  goals: [{ name: 'Pricing', match: { kind: 'page', path: '/pricing' } }],
}

describe('sessions', () => {
  it('counts a defined goal only when it was reached in range', () => {
    expect(sessions(scope).sql).toContain(`SELECT session_id FROM events WHERE ${inRange} AND (`)
  })
})

describe('visitorFunnelSql', () => {
  it('moves a visitor at most one step per event, across the range', () => {
    const { sql } = visitorFunnelSql(
      { ...scope, filters: {} },
      [
        { kind: 'page', path: '/products/*' },
        { kind: 'page', path: '/products/pro' },
      ],
      scope.range,
    )
    expect(sql).toContain("windowFunnel(1209600000, 'strict_once')")
    expect(sql).toContain('GROUP BY visitor_id')
  })
})
