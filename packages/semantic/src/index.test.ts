import { describe, expect, it } from 'vitest'
import { defineSite } from './index'

describe('defineSite', () => {
  it('rejects metrics that reference undefined events', () => {
    expect(() =>
      defineSite({
        domain: 'example.com',
        about: 'test',
        events: [],
        metrics: [
          { name: 'm', description: '', numerator: { event: 'signup' }, higherIsBetter: true },
        ],
      }),
    ).toThrow(/unknown event "signup"/)
  })
})
