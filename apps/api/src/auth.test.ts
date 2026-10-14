import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

const TOKEN = 'a'.repeat(32)
let auth: typeof import('./auth')
let passwords: typeof import('./passwords')
let app: Hono

beforeAll(async () => {
  Object.assign(process.env, {
    ADMIN_TOKEN: TOKEN,
    DATABASE_URL: 'postgres://unused',
    CLICKHOUSE_URL: 'http://unused',
  })
  auth = await import('./auth')
  passwords = await import('./passwords')
  app = new Hono()
  app.post('/check', async (c) =>
    c.json({ result: auth.checkAdminToken(c, (await c.req.json()).token) }),
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

describe('admin token', () => {
  it('blocks every address once too many wrong tokens arrive overall', async () => {
    expect(await check(TOKEN, '10.0.0.1')).toEqual({ result: 'ok' })
    for (let i = 0; i < 500; i++)
      await check('wrong-token-guess-000000', `10.1.${i >> 8}.${i & 255}`)
    expect(await check(TOKEN, '10.9.9.9')).toEqual({ result: 'blocked' })
  })

  it('makes API keys that are told apart by a short prefix', () => {
    const { key, hash, prefix } = auth.newApiKey()
    expect(key.startsWith(prefix)).toBe(true)
    expect(prefix).toMatch(/^rc_.{6}$/)
    expect(auth.hashToken(key).equals(hash)).toBe(true)
  })
})
