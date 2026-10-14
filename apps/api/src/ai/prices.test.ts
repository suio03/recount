import { describe, expect, it } from 'vitest'
import { costMicros } from './prices'

describe('costMicros', () => {
  it('prices tokens at the model rate', () => {
    expect(costMicros('claude-sonnet-5-5', 1302, 517)).toBe(7774)
    expect(costMicros('claude-haiku-5-5', 10_000, 1_000)).toBe(1500)
  })

  it('prices an unknown model like Sonnet', () => {
    expect(costMicros('claude-next', 1000, 100)).toBe(costMicros('claude-sonnet-5-5', 1000, 100))
  })
})
