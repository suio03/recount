import { describe, expect, it } from 'vitest'
import { iconHost, iconLinks, imageType, isPublicAddress } from './fetch'

describe('isPublicAddress', () => {
  it('refuses addresses inside a network', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ])
      expect(isPublicAddress(ip), ip).toBe(false)
  })
  it('allows public ones', () => {
    for (const ip of ['1.1.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])
      expect(isPublicAddress(ip), ip).toBe(true)
  })
})

describe('iconHost', () => {
  it('keeps public host names only', () => {
    expect(iconHost('WWW.Example.com')).toBe('example.com')
    expect(iconHost('demo.recount.localhost')).toBeUndefined()
    expect(iconHost('printer.local')).toBeUndefined()
    expect(iconHost('127.0.0.1')).toBeUndefined()
    expect(iconHost('newsletter')).toBeUndefined()
  })
})

describe('iconLinks', () => {
  it('ranks a small sized icon first, then larger, SVG, apple-touch and the rest', () => {
    const html = `<html><head>
      <link rel="apple-touch-icon" href="/apple.png">
      <link rel="icon" href="/any.ico">
      <link rel='icon' type='image/svg+xml' href='/icon.svg'>
      <link rel="icon" sizes="192x192" href="/192.png">
      <link href="/32.png" rel="shortcut icon" sizes="32x32">
      <link rel="stylesheet" href="/style.css">
    </head><body><link rel="icon" href="/late.png"></body></html>`
    expect(iconLinks(html).map((c) => c.href)).toEqual([
      '/32.png',
      '/192.png',
      '/icon.svg',
      '/apple.png',
      '/any.ico',
    ])
  })
})

describe('imageType', () => {
  it('reads the type from the bytes', () => {
    expect(imageType(Buffer.from('89504e470d0a1a0a', 'hex'))).toBe('image/png')
    expect(imageType(Buffer.from('0000010001002020', 'hex'))).toBe('image/x-icon')
    expect(imageType(Buffer.from('  <svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml',
    )
    expect(imageType(Buffer.from('<!doctype html><html>'))).toBeUndefined()
  })
})
