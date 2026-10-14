import { describe, expect, it } from 'vitest'
import { days, intervalOf, previousRange, RangeQuery } from './range'

describe('previousRange', () => {
  it('returns the same number of days ending the day before', () => {
    expect(previousRange({ from: '2026-09-14', to: '2026-10-13' })).toEqual({
      from: '2026-08-15',
      to: '2026-09-13',
    })
    expect(previousRange({ from: '2026-10-13', to: '2026-10-13' })).toEqual({
      from: '2026-10-12',
      to: '2026-10-12',
    })
  })

  it('counts days inclusively across a month end', () => {
    expect(days({ from: '2026-02-27', to: '2026-03-02' })).toBe(4)
  })
})

describe('RangeQuery', () => {
  it('rejects reversed and oversized ranges', () => {
    expect(RangeQuery.safeParse({ from: '2026-10-13', to: '2026-10-12' }).success).toBe(false)
    expect(RangeQuery.safeParse({ from: '2010-01-01', to: '2026-01-01' }).success).toBe(false)
    expect(RangeQuery.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(true)
    expect(RangeQuery.safeParse({ from: '2026-10-01', to: '2026-10-13' }).success).toBe(true)
  })
})

describe('intervalOf', () => {
  it('uses minutes for realtime, hours for a day, months past a quarter', () => {
    expect(intervalOf({ from: '2026-10-14', to: '2026-10-14', since: 1 })).toBe('minute')
    expect(intervalOf({ from: '2026-10-14', to: '2026-10-14' })).toBe('hour')
    expect(intervalOf({ from: '2026-09-15', to: '2026-10-14' })).toBe('day')
    expect(intervalOf({ from: '2025-11-01', to: '2026-10-14' })).toBe('month')
  })
})

describe('previousRange for realtime', () => {
  it('is the same stretch of time just before', () => {
    const now = Date.parse('2026-10-14T00:10:00Z')
    const since = now - 30 * 60_000
    expect(previousRange({ from: '2026-10-13', to: '2026-10-14', since }, now)).toEqual({
      from: '2026-10-12',
      to: '2026-10-14',
      since: since - 30 * 60_000,
      until: since,
    })
  })
})
