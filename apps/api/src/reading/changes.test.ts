import { describe, expect, it } from 'vitest'
import { changePoint, movers, pickConversions, relChange, topMovers } from './changes'

describe('relChange', () => {
  it('is null without a baseline', () => {
    expect(relChange(5, 0)).toBeNull()
    expect(relChange(15, 10)).toBe(0.5)
  })
})

describe('movers', () => {
  const current = [
    { value: 'AI Assistant', visitors: 300 },
    { value: 'Search', visitors: 505 },
    { value: 'Tiny', visitors: 4 },
    { value: 'New', visitors: 40 },
  ]
  const previous = [
    { value: 'AI Assistant', visitors: 100 },
    { value: 'Search', visitors: 500 },
    { value: 'Tiny', visitors: 1 },
    { value: 'Gone', visitors: 60 },
  ]

  it('keeps large relative changes above the visitor floor, including new and gone values', () => {
    const found = movers('channel', current, previous, { minVisitors: 20 })
    expect(found.map((m) => m.value).sort()).toEqual(['AI Assistant', 'Gone', 'New'])
    expect(found.find((m) => m.value === 'Gone')).toMatchObject({ current: 0, excess: -60 })
  })

  it('ignores segments that only moved with the total', () => {
    const found = movers(
      'browser',
      [
        { value: 'Chrome', visitors: 120 },
        { value: 'Safari', visitors: 300 },
      ],
      [
        { value: 'Chrome', visitors: 100 },
        { value: 'Safari', visitors: 100 },
      ],
      { minVisitors: 20, trend: 1.2 },
    )
    expect(found.map((m) => m.value)).toEqual(['Safari'])
    expect(found[0]?.excess).toBe(180)
  })
})

describe('topMovers', () => {
  it('ranks by distance from the trend and caps each dimension', () => {
    const picked = topMovers(
      [
        { dimension: 'referrer', value: 'a', current: 500, previous: 100, excess: 400 },
        { dimension: 'referrer', value: 'b', current: 400, previous: 100, excess: 300 },
        { dimension: 'referrer', value: 'c', current: 300, previous: 100, excess: 200 },
        { dimension: 'country', value: 'US', current: 50, previous: 150, excess: -100 },
      ],
      { perDimension: 2 },
    )
    expect(picked.map((m) => m.value)).toEqual(['a', 'b', 'US'])
  })
})

describe('changePoint', () => {
  it('finds the first day of a step up', () => {
    expect(changePoint([10, 12, 9, 11, 10, 30, 32, 29, 31])).toBe(5)
  })

  it('ignores noise without a step', () => {
    expect(changePoint([10, 12, 9, 11, 10, 12, 9, 11, 10])).toBeUndefined()
  })

  it('needs enough days on each side', () => {
    expect(changePoint([10, 10, 10, 10, 50])).toBeUndefined()
    expect(changePoint([1, 2])).toBeUndefined()
  })
})

describe('pickConversions', () => {
  const at = (value: string, visitors: number, converted: number) => ({
    dimension: 'referrer' as const,
    value,
    goal: 'Signup',
    visitors,
    converted,
    baseline: 0.02,
    explains: false,
  })

  it('keeps clear gaps from the baseline, largest in conversions first', () => {
    const found = pickConversions([
      at('chatgpt.com', 2000, 10), // 0.5% vs 2%: 30 conversions short
      at('google', 1000, 21), // 2.1%: no gap
      at('news', 500, 20), // 4%: 10 conversions ahead
    ])
    expect(found.map((c) => c.value)).toEqual(['chatgpt.com', 'news'])
  })

  it('ignores segments too small to expect a few conversions', () => {
    expect(pickConversions([at('tiny', 100, 0)])).toEqual([])
  })

  it('keeps a segment that explains a moved goal even without a gap, ahead of the rest', () => {
    const found = pickConversions([
      at('news', 500, 20),
      { ...at('chatgpt.com', 2000, 40), explains: true },
    ])
    expect(found.map((c) => c.value)).toEqual(['chatgpt.com', 'news'])
  })
})
