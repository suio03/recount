import { describe, expect, it, vi } from 'vitest'
import { type Activity, attentionOf, byUrgency } from './activity'

vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))
vi.mock('../db/postgres', () => ({ db: {} }))

const days = (...visitors: number[]) =>
  visitors.map((v, i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, visitors: v }))

const base = {
  days: days(20, 20, 20),
  usual: 20,
  week: { visitors: 100, previous: 100 },
  tries: null,
  quiet: [],
}

describe('attentionOf', () => {
  it('is empty on an ordinary day', () => {
    expect(attentionOf(base)).toEqual([])
  })

  it('calls a site silent when nothing came yesterday or today, not also a drop', () => {
    expect(attentionOf({ ...base, days: days(20, 0, 0) })).toEqual([{ kind: 'silent' }])
  })

  it('compares yesterday, the last full day, with a usual day', () => {
    expect(attentionOf({ ...base, days: days(20, 8, 0) })).toEqual([
      { kind: 'drop', yesterday: 8, usual: 20 },
    ])
    expect(attentionOf({ ...base, days: days(20, 50, 3) })).toEqual([
      { kind: 'spike', yesterday: 50, usual: 20 },
    ])
  })

  it('leaves small sites alone', () => {
    expect(attentionOf({ ...base, usual: 4, days: days(4, 0, 0) })).toEqual([])
    expect(attentionOf({ ...base, usual: null, days: days(0, 0, 0) })).toEqual([])
  })

  it('lists quiet events and people who tried to pay without paying', () => {
    expect(
      attentionOf({
        ...base,
        quiet: [{ name: 'signup', days: 3 }],
        tries: { tried: 3, paid: 1, triedBefore: 0, paidBefore: 0 },
      }),
    ).toEqual([
      { kind: 'quiet', events: 1 },
      { kind: 'unpaid', tried: 3, paid: 1 },
    ])
    expect(
      attentionOf({ ...base, tries: { tried: 2, paid: 2, triedBefore: 0, paidBefore: 0 } }),
    ).toEqual([])
  })
})

describe('byUrgency', () => {
  const site = (siteId: string, a: Partial<Activity>): Activity => ({
    siteId,
    ...base,
    attention: [],
    ...a,
  })
  it('puts what is broken first, then who tried to pay, then visitors', () => {
    const sorted = [
      site('big', { week: { visitors: 900, previous: 0 } }),
      site('trying', { tries: { tried: 2, paid: 2, triedBefore: 0, paidBefore: 0 } }),
      site('unpaid', { attention: [{ kind: 'unpaid', tried: 1, paid: 0 }] }),
      site('silent', { attention: [{ kind: 'silent' }] }),
    ].sort(byUrgency)
    expect(sorted.map((s) => s.siteId)).toEqual(['silent', 'unpaid', 'trying', 'big'])
  })
})
