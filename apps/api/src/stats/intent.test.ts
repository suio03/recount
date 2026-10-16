import { describe, expect, it, vi } from 'vitest'
import { compress, endingOf, guessKeyEvents, guessRole } from './intent'

vi.mock('../db/clickhouse', () => ({ clickhouse: {} }))
vi.mock('../db/postgres', () => ({ db: {} }))

describe('guessRole', () => {
  it('reads payment events by their words', () => {
    expect(guessRole('checkout_click')).toBe('start')
    expect(guessRole('checkoutOpened')).toBe('start')
    expect(guessRole('paddle_load_fail')).toBe('failed')
    expect(guessRole('checkout_closed')).toBe('closed')
    expect(guessRole('payment_success')).toBe('paid')
    expect(guessRole('Purchase')).toBe('paid')
  })

  it('does not take plans or paywalls for payments', () => {
    expect(guessRole('book_plan_start')).toBeUndefined()
    expect(guessRole('book_paywall_view')).toBe('interest')
    expect(guessRole('upgrade_cta_click')).toBe('interest')
  })

  it('reads sign-ins as activation, not their failures', () => {
    expect(guessRole('signin_success')).toBe('activation')
    expect(guessRole('Sign Up')).toBe('activation')
    expect(guessRole('login_failed')).toBeUndefined()
  })
})

describe('guessKeyEvents', () => {
  it('prefers successful sign-ins over attempts', () => {
    const k = guessKeyEvents(['signin_start', 'signin_success', 'checkout_click', 'checkout_fail'])
    expect(k).toEqual({
      activation: ['signin_success'],
      start: ['checkout_click'],
      paid: [],
      failed: ['checkout_fail'],
      closed: [],
    })
  })
})

describe('endingOf', () => {
  it('says how a try ended', () => {
    expect(endingOf(['start', 'failed'], false)).toBe('failed')
    expect(endingOf(['start', 'closed'], false)).toBe('closed')
    expect(endingOf(['failed', 'start', undefined], false)).toBe('none')
    expect(endingOf(['start', 'failed', 'paid'], false)).toBe('paid')
    expect(endingOf(['start'], true)).toBe('paid')
  })
})

describe('compress', () => {
  it('folds repeats into one entry', () => {
    const events = guessKeyEvents(['checkout_click'])
    const trail = compress(['a', 'a', 'checkout_click', 'transcribe_fail'], [1, 2, 3, 4], events)
    expect(trail).toEqual([
      { name: 'a', at: 1, n: 2, role: undefined, fault: false },
      { name: 'checkout_click', at: 3, n: 1, role: 'start', fault: false },
      { name: 'transcribe_fail', at: 4, n: 1, role: undefined, fault: true },
    ])
  })
})
