import { describe, expect, it } from 'vitest'
import { count, describe as describeFinding, signed, unsupportedNumbers } from './format'

describe('count', () => {
  it('matches the dashboard: plain below 1k, lowercase k above', () => {
    expect(count(950)).toBe('950')
    expect(count(3119)).toBe('3.1k')
    expect(count(3000)).toBe('3k')
    expect(count(123_456)).toBe('123k')
  })
})

describe('signed', () => {
  it('rounds to whole percents and marks missing baselines', () => {
    expect(signed(0.784)).toBe('+78%')
    expect(signed(-0.34)).toBe('-34%')
    expect(signed(null)).toBe('new (no baseline)')
  })
})

describe('describe', () => {
  it('lists the figures the model may quote', () => {
    const text = describeFinding({
      id: 'f2',
      subject: { kind: 'segment', dimension: 'channel', value: 'AI Assistant' },
      metric: 'visitors',
      current: 3119,
      previous: 1752,
      change: 0.78,
      share: 0.6,
      since: '2026-10-04',
      filters: { channel: 'AI Assistant' },
    })
    expect(text).toContain('[f2] Channel = AI Assistant: visitors')
    expect(text).toContain('now 3.1k, before 1.8k, change +78%')
    expect(text).toContain('60% of the total visitor change')
    expect(text).toContain('Oct 4')
  })
})

describe('describe a segment conversion', () => {
  it('gives the rate for all visitors to compare against', () => {
    const text = describeFinding({
      id: 'f7',
      subject: {
        kind: 'segment_goal',
        dimension: 'referrer',
        value: 'chatgpt.com',
        name: 'Signup',
      },
      metric: 'conversion_rate',
      current: 0.005,
      previous: 0.006,
      change: -0.17,
      baseline: 0.009,
      filters: { referrer: 'chatgpt.com' },
    })
    expect(text).toContain('Goal "Signup" among visitors with Referrer = chatgpt.com')
    expect(text).toContain('now 0.5%, before 0.6%')
    expect(text).toContain('among all visitors in scope it is 0.9%')
  })
})

describe('unsupportedNumbers', () => {
  const evidence = ['now 3.1k, before 1.8k, change +78%', 'the shift starts on Oct 4']

  it('accepts figures copied from the evidence', () => {
    expect(
      unsupportedNumbers('AI Assistant visitors rose 78% to 3.1k from Oct 4.', evidence),
    ).toEqual([])
  })

  it('flags figures the evidence does not contain', () => {
    expect(unsupportedNumbers('Visitors rose 85% to 3,119.', evidence)).toEqual(['85%', '3119'])
  })
})
