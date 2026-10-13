import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { clientIp } from './client-ip'
import { env } from './env'

/**
 * One owner, one secret: scripts send ADMIN_TOKEN as a bearer token, and the dashboard trades it
 * once for a cookie. The cookie holds a value derived from the token rather than the token
 * itself, and changing ADMIN_TOKEN signs every browser out.
 */

const COOKIE = 'rc_admin'
const MAX_AGE = 30 * 24 * 3600
const session = createHmac('sha256', env.ADMIN_TOKEN).update('recount dashboard').digest('hex')

function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Wrong guesses are capped per address, and across all addresses, since anyone who can reach the
 * server directly can claim any address. An open-source install may run with a weak token.
 */
const WINDOW_MS = 15 * 60_000
const PER_ADDRESS = 20
const OVERALL = 500
const failures = new Map<string, { count: number; until: number }>()
let overall = { count: 0, until: 0 }

function blocked(ip: string, now = Date.now()) {
  const mine = failures.get(ip)
  return (
    (mine !== undefined && mine.until > now && mine.count >= PER_ADDRESS) ||
    (overall.until > now && overall.count >= OVERALL)
  )
}

function fail(ip: string, now = Date.now()) {
  if (overall.until <= now) overall = { count: 0, until: now + WINDOW_MS }
  overall.count++
  const mine = failures.get(ip)
  if (mine && mine.until > now) mine.count++
  else {
    // Spoofed addresses could grow the map without end; expired entries go first.
    if (failures.size >= 10_000)
      for (const [key, entry] of failures) if (entry.until <= now) failures.delete(key)
    if (failures.size < 10_000) failures.set(ip, { count: 1, until: now + WINDOW_MS })
  }
}

type Check = 'ok' | 'missing' | 'wrong' | 'blocked'

/** Checks `secret` against `expected`, counting wrong ones; while blocked nothing is checked. */
function check(c: Context, secret: string | undefined, expected: string): Check {
  if (secret === undefined) return 'missing'
  const ip = clientIp(c)
  if (blocked(ip)) return 'blocked'
  if (same(secret, expected)) return 'ok'
  fail(ip)
  return 'wrong'
}

function admin(c: Context): Check {
  const header = c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) return check(c, header.slice(7), env.ADMIN_TOKEN)
  // The cookie is an HMAC nobody can guess, so it is neither counted nor blocked: a flood of
  // wrong tokens must not lock the owner's signed-in browser out.
  const cookie = getCookie(c, COOKIE)
  if (cookie === undefined) return 'missing'
  if (same(cookie, session)) return 'ok'
  // A cookie from before ADMIN_TOKEN changed: drop it so the browser stops sending it.
  signOut(c)
  return 'wrong'
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const result = admin(c)
  if (result === 'blocked') return c.json({ error: 'too many attempts' }, 429)
  if (result !== 'ok') return c.json({ error: 'unauthorized' }, 401)
  await next()
}

/** Signs the browser in when `token` is ADMIN_TOKEN. */
export function signIn(c: Context, token: string): Exclude<Check, 'missing'> {
  const result = check(c, token, env.ADMIN_TOKEN)
  if (result !== 'ok') return result === 'missing' ? 'wrong' : result
  // Behind a TLS-terminating proxy the request itself is plain http.
  const https = c.req.header('X-Forwarded-Proto') === 'https' || c.req.url.startsWith('https:')
  setCookie(c, COOKIE, session, {
    httpOnly: true,
    secure: https,
    sameSite: 'Strict',
    path: '/',
    maxAge: MAX_AGE,
  })
  return 'ok'
}

export function signOut(c: Context) {
  deleteCookie(c, COOKIE, { path: '/' })
}
