import { describe, expect, it, vi } from 'vitest'
import { usualOf, usualRange } from './usual'

vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))

const days = (counts: number[], start = '2026-10-01') =>
  counts.map((visitors, i) => ({
    day: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10),
    visitors,
  }))

describe('usualOf', () => {
  it('takes the median day', () => {
    expect(usualOf(days([10, 30, 20, 25, 50, 15, 40]), '2026-10-01', '2026-10-07')).toBe(25)
  })

  it('counts quiet days after the first as zero', () => {
    const data = days([10, 10, 10, 10]).concat(days([10, 10, 10], '2026-10-08'))
    // Oct 5–7 are missing: 10 days, three of them zero.
    expect(usualOf(data, '2026-10-01', '2026-10-10')).toBe(10)
    expect(
      usualOf(days([4, 4, 4]).concat(days([4], '2026-10-10')), '2026-10-01', '2026-10-10'),
    ).toBe(0)
  })

  it('leaves out the days before the site had data', () => {
    expect(usualOf(days([8, 8, 8, 8, 8, 8, 8], '2026-10-20'), '2026-10-01', '2026-10-26')).toBe(8)
  })

  it('has no usual day with under a week of data', () => {
    expect(usualOf(days([5, 5, 5], '2026-10-26'), '2026-10-01', '2026-10-28')).toBeUndefined()
  })
})

describe('usualRange', () => {
  it('is the 28 days before the range', () => {
    expect(usualRange({ from: '2026-10-10', to: '2026-10-16' })).toEqual({
      from: '2026-09-12',
      to: '2026-10-09',
    })
  })
})
