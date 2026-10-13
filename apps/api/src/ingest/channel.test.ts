import { describe, expect, it } from 'vitest'
import { classifyChannel } from './channel'

const c = (source: string, utmMedium = '', clickIdType = '') =>
  classifyChannel({ source, utmMedium, clickIdType })

describe('classifyChannel', () => {
  it('classifies common sources', () => {
    expect(c('')).toBe('Direct')
    expect(c('google.com')).toBe('Organic Search')
    expect(c('google.com', 'cpc')).toBe('Paid Search')
    expect(c('chatgpt.com')).toBe('AI Assistant')
    expect(c('x.com')).toBe('Organic Social')
    expect(c('reddit.com', '', 'fbclid')).toBe('Paid Social')
    expect(c('', 'email')).toBe('Email')
    expect(c('someblog.dev')).toBe('Referral')
  })
})
