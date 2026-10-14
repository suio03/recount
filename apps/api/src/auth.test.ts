import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

let auth: typeof import('./auth')
let passwords: typeof import('./passwords')
let app: Hono

beforeAll(async () => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://unused',
    CLICKHOUSE_URL: 'http://unused',
  })
  auth = await import('./auth')
  passwords = await import('./passwords')
  app = new Hono()
  app.post('/check', async (c) =>
    c.json({ result: auth.checkSetupCode(c, (await c.req.json()).token) }),
  )
})

async function check(token: string, ip: string) {
  const res = await app.request('/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ token }),
  })
  return res.json()
}

describe('passwords', () => {
  it('verifies the password a hash was made from, and only that one', async () => {
    const hash = await passwords.hashPassword('correct horse battery')
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/)
    expect(await passwords.verifyPassword('correct horse battery', hash)).toBe(true)
    expect(await passwords.verifyPassword('correct horse batterz', hash)).toBe(false)
    expect(await passwords.verifyPassword('anything', 'plain-text')).toBe(false)
  })
})

describe('roles', () => {
  it('ranks owner over admin over viewer', () => {
    expect(auth.atLeast('owner', 'admin')).toBe(true)
    expect(auth.atLeast('admin', 'admin')).toBe(true)
    expect(auth.atLeast('viewer', 'admin')).toBe(false)
    expect(auth.atLeast(undefined, 'viewer')).toBe(false)
  })

  it('lets only owners give or take away ownership', () => {
    expect(auth.canAssign('owner', 'owner')).toBe(true)
    expect(auth.canAssign('admin', 'admin')).toBe(true)
    expect(auth.canAssign('admin', 'viewer')).toBe(true)
    expect(auth.canAssign('admin', 'owner')).toBe(false)
    expect(auth.canAssign('viewer', 'viewer')).toBe(false)
  })
})

describe('setup code', () => {
  it('keeps one code until it is used, and accepts it in any case or spacing', async () => {
    const first = auth.currentSetupCode()
    expect(first.fresh).toBe(true)
    expect(first.code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/)
    expect(auth.currentSetupCode()).toEqual({ code: first.code, fresh: false })
    const sloppy = first.code.toLowerCase().replaceAll('-', ' ')
    expect(await check(sloppy, '10.0.0.1')).toEqual({ result: 'ok' })
    auth.clearSetupCode()
    expect(await check(first.code, '10.0.0.1')).toEqual({ result: 'wrong' })
  })

  it('blocks every address once too many wrong guesses arrive overall', async () => {
    const { code } = auth.currentSetupCode()
    expect(await check(code, '10.0.0.2')).toEqual({ result: 'ok' })
    for (let i = 0; i < 500; i++) await check('WRONG-GUES-S000', `10.1.${i >> 8}.${i & 255}`)
    expect(await check(code, '10.9.9.9')).toEqual({ result: 'blocked' })
  })

  it('makes API keys that are told apart by a short prefix', () => {
    const { key, hash, prefix } = auth.newApiKey()
    expect(key.startsWith(prefix)).toBe(true)
    expect(prefix).toMatch(/^rc_.{6}$/)
    expect(auth.hashToken(key).equals(hash)).toBe(true)
  })
})
