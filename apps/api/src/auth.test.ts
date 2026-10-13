import { Hono } from 'hono'
import { beforeAll, describe, expect, it } from 'vitest'

const TOKEN = 'a'.repeat(32)
let app: Hono

beforeAll(async () => {
  Object.assign(process.env, {
    ADMIN_TOKEN: TOKEN,
    DATABASE_URL: 'postgres://unused',
    CLICKHOUSE_URL: 'http://unused',
  })
  const { requireAdmin, signIn } = await import('./auth')
  app = new Hono()
  app.post('/login', async (c) => c.json({ result: signIn(c, (await c.req.json()).token) }))
  app.get('/private', requireAdmin, (c) => c.json({ ok: true }))
})

const login = (token: string, ip: string) =>
  app.request('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ token }),
  })

describe('auth', () => {
  it('keeps a signed-in browser working while wrong guesses are blocked', async () => {
    const cookie = (await login(TOKEN, '10.0.0.1')).headers.get('set-cookie')?.split(';')[0] ?? ''
    expect(cookie).toMatch(/^rc_admin=/)

    // Enough wrong guesses from many addresses to trip the overall cap.
    for (let i = 0; i < 500; i++)
      await login('wrong-token-guess-000000', `10.1.${i >> 8}.${i & 255}`)
    expect(await (await login(TOKEN, '10.9.9.9')).json()).toEqual({ result: 'blocked' })

    const res = await app.request('/private', { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
  })

  it('rejects and clears a stale cookie', async () => {
    const res = await app.request('/private', { headers: { Cookie: 'rc_admin=stale' } })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toMatch(/rc_admin=;/)
  })
})
