import { describe, expect, it, vi } from 'vitest'
import { quietOf } from './quiet'

vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))

const DAY = 86_400_000
const day = (back: number) =>
  new Date(Date.parse('2026-10-15') - back * DAY).toISOString().slice(0, 10)

/** Daily counts for one event, `counts[0]` being the end day and going back from there. */
const series = (name: string, counts: number[]) =>
  counts.map((events, back) => ({ name, day: day(back), events })).filter((d) => d.events > 0)

describe('quietOf', () => {
  it('finds a steady event that stopped two full days ago', () => {
    const [quiet] = quietOf(series('checkout_click', [0, 0, ...Array(14).fill(5)]), day(0))
    expect(quiet).toMatchObject({
      name: 'checkout_click',
      days: 2,
      last: day(2),
      active: 14,
      perDay: 5,
      recent: [5, 5, 5, 5, 5, 0, 0],
    })
  })

  it('waits for two full days at zero', () => {
    expect(quietOf(series('a', [0, ...Array(14).fill(5)]), day(0))).toEqual([])
  })

  it('leaves out an event that fires today', () => {
    const daily = series('a', [0, 0, ...Array(14).fill(5)])
    expect(quietOf(daily, day(0), new Map([['a', 1]]))).toEqual([])
  })

  it('needs 10 active days and 2 a day before it stopped', () => {
    const sparse = [0, 0, ...Array(9).fill(9), ...Array(5).fill(0)]
    const thin = [0, 0, ...Array(14).fill(1)]
    expect(quietOf([...series('sparse', sparse), ...series('thin', thin)], day(0))).toEqual([])
  })

  it('stops reporting an event gone for over 30 days', () => {
    expect(quietOf(series('a', [...Array(31).fill(0), ...Array(14).fill(5)]), day(0))).toEqual([])
  })
})
