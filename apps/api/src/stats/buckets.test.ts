import { describe, expect, it } from 'vitest'
import { bucketsOf } from './buckets'

describe('bucketsOf', () => {
  const now = Date.parse('2026-10-14T03:20:30Z')

  it('lists the hours of today up to the current one, in the site timezone', () => {
    // 03:20 UTC is 12:20 in Tokyo.
    const hours = bucketsOf({ from: '2026-10-14', to: '2026-10-14' }, 'Asia/Tokyo', now)
    expect(hours).toHaveLength(13)
    expect(hours[0]).toBe('2026-10-14 00:00:00')
    expect(hours.at(-1)).toBe('2026-10-14 12:00:00')
  })

  it('lists every hour of a past day', () => {
    expect(bucketsOf({ from: '2026-10-12', to: '2026-10-12' }, 'UTC', now)).toHaveLength(24)
  })

  it('lists the minutes since the realtime start, including the current one', () => {
    const since = Date.parse('2026-10-14T02:50:00Z')
    const minutes = bucketsOf({ from: '2026-10-14', to: '2026-10-14', since }, 'UTC', now)
    expect(minutes).toHaveLength(31)
    expect(minutes[0]).toBe('2026-10-14 02:50:00')
    expect(minutes.at(-1)).toBe('2026-10-14 03:20:00')
  })

  it('lists months for long ranges', () => {
    expect(bucketsOf({ from: '2025-11-01', to: '2026-10-14' }, 'UTC', now)).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
      '2026-06-01',
      '2026-07-01',
      '2026-08-01',
      '2026-09-01',
      '2026-10-01',
    ])
  })

  it('lists days, leaving out the future', () => {
    expect(bucketsOf({ from: '2026-10-10', to: '2026-10-20' }, 'UTC', now)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ])
  })
})
