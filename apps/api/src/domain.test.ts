import { describe, expect, it } from 'vitest'
import { normalizeDomain, validTimezone } from './domain'

describe('normalizeDomain', () => {
  it('keeps the hostname of a pasted address', () => {
    expect(normalizeDomain('https://www.Example.com/pricing?x=1')).toBe('example.com')
    expect(normalizeDomain(' blog.example.co.uk ')).toBe('blog.example.co.uk')
    expect(normalizeDomain('example.com:8080/')).toBe('example.com')
    expect(normalizeDomain('example.com.')).toBe('example.com')
  })

  it('refuses what the tracker would never report', () => {
    expect(normalizeDomain('localhost')).toBeUndefined()
    expect(normalizeDomain('192.168.0.1')).toBeUndefined()
    expect(normalizeDomain('not a domain')).toBeUndefined()
    expect(normalizeDomain('-bad.com')).toBeUndefined()
    expect(normalizeDomain('')).toBeUndefined()
  })
})

describe('validTimezone', () => {
  it('knows IANA names', () => {
    expect(validTimezone('UTC')).toBe(true)
    expect(validTimezone('Asia/Shanghai')).toBe(true)
    expect(validTimezone('Mars/Olympus')).toBe(false)
  })
})
