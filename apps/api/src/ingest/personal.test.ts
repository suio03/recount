import { describe, expect, it } from 'vitest'
import { personalName, personalProperties, personalValue, withoutPersonal } from './personal'

describe('personalName', () => {
  it('flags names of contact details in any case style', () => {
    for (const name of ['email', 'userEmail', 'user_email', 'Phone', 'first_name', 'lastName'])
      expect(personalName(name)).toBeDefined()
    expect(personalName('creditCardNumber')).toBeDefined()
    expect(personalName('ip_address')).toBeDefined()
  })

  it('leaves business properties alone', () => {
    for (const name of ['plan', 'amount', 'tool', 'placement', 'name', 'results', 'emailed'])
      expect(personalName(name)).toBeUndefined()
  })
})

describe('personalValue', () => {
  it('flags emails, phones, cards and IP addresses', () => {
    expect(personalValue('jo@example.com')).toBe('holds an email address')
    expect(personalValue('+1 415 555 0100')).toBe('holds a phone number')
    expect(personalValue('(415) 555-0100')).toBe('holds a phone number')
    expect(personalValue('4242 4242 4242 4242')).toBe('holds a card number')
    expect(personalValue('4242424242424242')).toBe('holds a card number')
    expect(personalValue('192.168.1.20')).toBe('holds an IP address')
    expect(personalValue('call me on +44 20 7946 0958')).toBe('holds a phone number')
  })

  it('leaves amounts, ids, versions and timestamps alone', () => {
    for (const value of [
      '19.99',
      '1999',
      'pro',
      '1734567890',
      '2.1.6',
      'abc-123',
      '2026-10-16',
      'up +12%',
      'C++ 2023',
    ])
      expect(personalValue(value)).toBeUndefined()
  })
})

describe('personalProperties', () => {
  it('names each property and why', () => {
    expect(personalProperties({ plan: 'pro', contact: 'jo@example.com', email: 'x' })).toEqual([
      { key: 'contact', reason: '"contact" holds an email address' },
      { key: 'email', reason: '"email" names personal data' },
    ])
    expect(withoutPersonal({ plan: 'pro', email: 'x' })).toEqual({ plan: 'pro' })
  })
})
