import { describe, expect, it } from 'vitest'
import { periodLabel, readPeriod, resolve, shift } from './period'

// Wednesday 14 October 2026, 10:00 UTC.
const now = Date.parse('2026-10-14T10:00:00Z')
const tz = 'UTC'

describe('resolve', () => {
  it('turns presets into days', () => {
    const r = (preset: Parameters<typeof resolve>[0]) => resolve(preset, tz, null, now)
    expect(r({ preset: 'today' })).toEqual({ from: '2026-10-14', to: '2026-10-14' })
    expect(r({ preset: 'yesterday' })).toEqual({ from: '2026-10-13', to: '2026-10-13' })
    expect(r({ preset: '7d' })).toEqual({ from: '2026-10-08', to: '2026-10-14' })
    expect(r({ preset: '30d' })).toEqual({ from: '2026-09-15', to: '2026-10-14' })
    expect(r({ preset: 'month' })).toEqual({ from: '2026-10-01', to: '2026-10-14' })
    expect(r({ preset: 'last-month' })).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(r({ preset: 'year' })).toEqual({ from: '2026-01-01', to: '2026-10-14' })
    expect(r({ preset: '12mo' })).toEqual({ from: '2025-11-01', to: '2026-10-14' })
  })

  it('starts all time at the first event, in the site timezone', () => {
    expect(resolve({ preset: 'all' }, 'Asia/Tokyo', '2024-03-01T20:00:00Z', now).from).toBe(
      '2024-03-02',
    )
    expect(resolve({ preset: 'all' }, tz, null, now).from).toBe('2026-10-14')
  })

  it('gives realtime the last 30 minutes to the minute', () => {
    const r = resolve({ preset: 'realtime' }, tz, null, now + 25_000)
    expect(r.since).toBe(now - 30 * 60_000)
    expect(r.to).toBe('2026-10-14')
  })
})

describe('shift', () => {
  it('steps days, months and years', () => {
    expect(shift({ preset: 'today' }, -1, tz, now)).toEqual({ preset: 'yesterday' })
    expect(shift({ preset: 'yesterday' }, 1, tz, now)).toEqual({ preset: 'today' })
    expect(shift({ preset: 'yesterday' }, -1, tz, now)).toEqual({
      preset: 'custom',
      from: '2026-10-12',
      to: '2026-10-12',
    })
    expect(shift({ preset: 'month' }, -1, tz, now)).toEqual({
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(shift({ preset: 'last-month' }, 1, tz, now)).toEqual({ preset: 'month' })
    expect(shift({ preset: 'year' }, -1, tz, now)).toEqual({
      preset: 'custom',
      from: '2025-01-01',
      to: '2025-12-31',
    })
    expect(shift({ preset: '7d' }, -1, tz, now)).toEqual({
      preset: 'custom',
      from: '2026-10-01',
      to: '2026-10-07',
    })
  })

  it('does not step into the future, or from realtime and all time', () => {
    expect(shift({ preset: 'today' }, 1, tz, now)).toBeUndefined()
    expect(shift({ preset: 'realtime' }, -1, tz, now)).toBeUndefined()
    expect(shift({ preset: 'all' }, -1, tz, now)).toBeUndefined()
  })

  it('steps a month-to-date on the first of the month back a whole month', () => {
    const first = Date.parse('2026-10-01T10:00:00Z')
    expect(shift({ preset: 'month' }, -1, tz, first)).toEqual({
      preset: 'custom',
      from: '2026-09-01',
      to: '2026-09-30',
    })
  })
})

describe('periodLabel', () => {
  it('names custom periods in words', () => {
    const label = (from: string, to: string) => periodLabel({ preset: 'custom', from, to }, tz, now)
    expect(label('2026-10-12', '2026-10-12')).toBe('Mon, Oct 12')
    expect(label('2026-09-01', '2026-09-30')).toBe('September 2026')
    expect(label('2025-01-01', '2025-12-31')).toBe('2025')
    expect(periodLabel({ preset: '7d' }, tz, now)).toBe('Last 7 Days')
  })
})

describe('readPeriod', () => {
  it('reads presets and custom days, falling back to 30 days', () => {
    expect(readPeriod(new URLSearchParams('range=today'))).toEqual({ preset: 'today' })
    expect(readPeriod(new URLSearchParams('range=custom&from=2026-10-01&to=2026-10-03'))).toEqual({
      preset: 'custom',
      from: '2026-10-01',
      to: '2026-10-03',
    })
    expect(readPeriod(new URLSearchParams('range=90d'))).toEqual({ preset: '30d' })
    expect(readPeriod(new URLSearchParams('range=custom&from=2026-10-05&to=2026-10-03'))).toEqual({
      preset: '30d',
    })
  })
})
