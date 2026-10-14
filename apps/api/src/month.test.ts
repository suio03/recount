import { describe, expect, it } from 'vitest'
import { monthBounds } from './month'

describe('monthBounds', () => {
  it('spans the month in UTC, rolling over the year', () => {
    expect(monthBounds('2026-12')).toEqual({
      from: new Date('2026-12-01T00:00:00Z'),
      to: new Date('2027-01-01T00:00:00Z'),
    })
  })
})
