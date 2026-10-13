import { describe, expect, it } from 'vitest'
import { days, previousRange, RangeQuery } from './range'

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
    expect(RangeQuery.safeParse({ from: '2024-01-01', to: '2026-01-01' }).success).toBe(false)
    expect(RangeQuery.safeParse({ from: '2026-10-01', to: '2026-10-13' }).success).toBe(true)
  })
})
