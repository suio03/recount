import { beforeAll, describe, expect, it } from 'vitest'

let secrets: typeof import('./secrets')

beforeAll(async () => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://unused',
    CLICKHOUSE_URL: 'http://unused',
    ENCRYPTION_KEY: 'a-test-key-that-is-at-least-32-characters',
  })
  secrets = await import('./secrets')
})

describe('seal', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const a = secrets.seal('pdl_live_apikey_example')
    const b = secrets.seal('pdl_live_apikey_example')
    expect(a.equals(b)).toBe(false)
    expect(a.includes(Buffer.from('pdl_live'))).toBe(false)
    expect(secrets.unseal(a)).toBe('pdl_live_apikey_example')
  })

  it('refuses a tampered value', () => {
    const sealed = secrets.seal('secret')
    sealed[sealed.length - 1] = (sealed[sealed.length - 1] ?? 0) ^ 1
    expect(() => secrets.unseal(sealed)).toThrow(/ENCRYPTION_KEY/)
  })
})
