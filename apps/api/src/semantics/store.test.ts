import { describe, expect, it } from 'vitest'

Object.assign(process.env, { DATABASE_URL: 'postgres://unused', CLICKHOUSE_URL: 'http://unused' })
const { last30Days, sameRule } = await import('./store')

describe('sameRule', () => {
  it('ignores field order and unset fields, and compares steps in order', () => {
    expect(
      sameRule(
        { kind: 'click', text: 'Visit', section: 'Tool profile' },
        { section: 'Tool profile', kind: 'click', text: 'Visit', href: undefined },
      ),
    ).toBe(true)
    expect(sameRule({ kind: 'page', path: '/a' }, { kind: 'page', path: '/b' })).toBe(false)
    const a = { kind: 'page', path: '/a' }
    const b = { kind: 'event', name: 'Signup' }
    expect(sameRule([a, b], [a, b])).toBe(true)
    expect(sameRule([a, b], [b, a])).toBe(false)
  })
})

describe('last30Days', () => {
  it('ends today in the site timezone and spans 30 days', () => {
    const now = Date.parse('2026-10-15T23:30:00Z')
    expect(last30Days('UTC', now)).toEqual({ from: '2026-09-16', to: '2026-10-15' })
    expect(last30Days('Asia/Tokyo', now)).toEqual({ from: '2026-09-17', to: '2026-10-16' })
  })
})
