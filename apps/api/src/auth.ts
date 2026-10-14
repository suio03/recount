import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { getConnInfo } from '@hono/node-server/conninfo'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { clientIp } from './client-ip'
import { db } from './db/postgres'
import { apiKeys, memberships, orgs, type Role, type User, userSessions, users } from './db/schema'
import { env } from './env'

/**
 * Who is calling the private API: a person, through the session cookie the dashboard gets at
 * sign-in, or a script with an org's API key (`Bearer rc_...`), acting as an admin of that org.
 */
export type Principal = { kind: 'user'; user: User } | { kind: 'key'; orgId: string }

export type AuthEnv = { Variables: { principal: Principal } }

const COOKIE = 'rc_session'
/** Set at sign-out while DEV_AUTO_LOGIN is on, so the sign-in form shows until the next sign-in. */
const SIGNED_OUT = 'rc_signed_out'
const SESSION_DAYS = 30
const KEY_PREFIX = 'rc_'

export const hashToken = (token: string) => createHash('sha256').update(token).digest()
export const newToken = (prefix = '') => prefix + randomBytes(32).toString('base64url')

function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * Wrong passwords and setup codes are capped per address, and across all addresses, since anyone
 * who can reach the server directly can claim any address. People pick weak passwords.
 */
const WINDOW_MS = 15 * 60_000
const PER_ADDRESS = 20
const OVERALL = 500
const failures = new Map<string, { count: number; until: number }>()
let overall = { count: 0, until: 0 }

export function blocked(c: Context, now = Date.now()) {
  const mine = failures.get(clientIp(c))
  return (
    (mine !== undefined && mine.until > now && mine.count >= PER_ADDRESS) ||
    (overall.until > now && overall.count >= OVERALL)
  )
}

export function fail(c: Context, now = Date.now()) {
  const ip = clientIp(c)
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

/**
 * The one-time code that creates the first account. It is only ever printed in the server log,
 * so whoever can read the log, which is whoever runs the server, claims a fresh install rather
 * than whoever opens the dashboard first. It lives in memory: a restart prints a new one.
 */
let setupCode: string | undefined
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

/** The current setup code, made the first time it is needed; `fresh` says whether it is new. */
export function currentSetupCode() {
  if (setupCode) return { code: setupCode, fresh: false }
  const chars = [...randomBytes(16)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  setupCode = [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-')
  return { code: setupCode, fresh: true }
}

export function clearSetupCode() {
  setupCode = undefined
}

type Check = 'ok' | 'wrong' | 'blocked'

/** Checks a guess at the setup code, counting wrong ones; while blocked nothing is checked. */
export function checkSetupCode(c: Context, guess: string): Check {
  if (blocked(c)) return 'blocked'
  if (setupCode && same(normalize(guess), normalize(setupCode))) return 'ok'
  fail(c)
  return 'wrong'
}

async function fromKey(key: string): Promise<Principal | undefined> {
  const [row] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.keyHash, hashToken(key)))
    .returning({ orgId: apiKeys.orgId })
  return row && { kind: 'key', orgId: row.orgId }
}

async function fromSession(token: string): Promise<Principal | undefined> {
  const [row] = await db
    .select({ user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(
      and(eq(userSessions.tokenHash, hashToken(token)), gt(userSessions.expiresAt, new Date())),
    )
  return row && { kind: 'user', user: row.user }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/**
 * The account DEV_AUTO_LOGIN signs in, for a request from `address`. Only outside production and
 * only from this machine: the socket's own address, since a forwarded one can be anything.
 */
export function autoLoginEmail(
  address: string | undefined,
  email = env.DEV_AUTO_LOGIN,
  nodeEnv = process.env.NODE_ENV,
) {
  if (!email || nodeEnv === 'production' || !address || !LOOPBACK.has(address)) return undefined
  return email.toLowerCase()
}

/** Starts a session for the DEV_AUTO_LOGIN account when it applies to this request. */
async function autoLogin(c: Context): Promise<Principal | undefined> {
  if (!env.DEV_AUTO_LOGIN || getCookie(c, SIGNED_OUT) !== undefined) return undefined
  let address: string | undefined
  try {
    address = getConnInfo(c).remote.address
  } catch {
    return undefined
  }
  const email = autoLoginEmail(address)
  if (!email) return undefined
  const user = await db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, email) })
  if (!user) return undefined
  await startSession(c, user.id)
  return { kind: 'user', user }
}

type Resolved = Principal | 'missing' | 'wrong' | 'blocked'

async function resolve(c: Context): Promise<Resolved> {
  const header = c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) {
    // Keys are 32 random bytes, so they cannot be guessed and wrong ones are not counted.
    const secret = header.slice(7)
    return (secret.startsWith(KEY_PREFIX) && (await fromKey(secret))) || 'wrong'
  }
  const cookie = getCookie(c, COOKIE)
  if (cookie === undefined) return (await autoLogin(c)) ?? 'missing'
  const principal = await fromSession(cookie)
  if (principal) return principal
  // Expired or signed out elsewhere: drop it so the browser stops sending it.
  deleteCookie(c, COOKIE, { path: '/' })
  return (await autoLogin(c)) ?? 'wrong'
}

export const requireAuth: MiddlewareHandler<AuthEnv> = async (c, next) => {
  const result = await resolve(c)
  if (result === 'blocked') return c.json({ error: 'too many attempts' }, 429)
  if (typeof result === 'string') return c.json({ error: 'unauthorized' }, 401)
  c.set('principal', result)
  await next()
}

/** Starts a browser session for `userId`. */
export async function startSession(c: Context, userId: string) {
  const token = newToken()
  await db.insert(userSessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
  })
  // Behind a TLS-terminating proxy the request itself is plain http.
  const https = c.req.header('X-Forwarded-Proto') === 'https' || c.req.url.startsWith('https:')
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: https,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
  deleteCookie(c, SIGNED_OUT, { path: '/' })
}

export async function endSession(c: Context) {
  const token = getCookie(c, COOKIE)
  if (token !== undefined)
    await db.delete(userSessions).where(eq(userSessions.tokenHash, hashToken(token)))
  deleteCookie(c, COOKIE, { path: '/' })
  if (env.DEV_AUTO_LOGIN)
    setCookie(c, SIGNED_OUT, '1', { httpOnly: true, sameSite: 'Strict', path: '/' })
}

/** Signs `userId` out everywhere except the browser making this request. */
export async function endOtherSessions(c: Context, userId: string) {
  const token = getCookie(c, COOKIE) ?? ''
  await db
    .delete(userSessions)
    .where(
      and(eq(userSessions.userId, userId), sql`${userSessions.tokenHash} <> ${hashToken(token)}`),
    )
}

export function pruneSessions() {
  return db.delete(userSessions).where(lt(userSessions.expiresAt, new Date()))
}

export function newApiKey() {
  const key = newToken(KEY_PREFIX)
  return { key, hash: hashToken(key), prefix: key.slice(0, KEY_PREFIX.length + 6) }
}

const RANK: Record<Role, number> = { viewer: 0, admin: 1, owner: 2 }

export const atLeast = (role: Role | undefined, needed: Role) =>
  role !== undefined && RANK[role] >= RANK[needed]

/** Admins manage admins and viewers; only owners give or take away ownership. */
export const canAssign = (actor: Role | undefined, role: Role) =>
  actor === 'owner' || (actor === 'admin' && role !== 'owner')

/** The orgs `principal` can see, with its role in each. */
export async function orgsOf(principal: Principal) {
  if (principal.kind === 'user')
    return db
      .select({ id: orgs.id, name: orgs.name, role: memberships.role })
      .from(memberships)
      .innerJoin(orgs, eq(orgs.id, memberships.orgId))
      .where(eq(memberships.userId, principal.user.id))
      .orderBy(orgs.createdAt)
  const all = await db
    .select({ id: orgs.id, name: orgs.name })
    .from(orgs)
    .where(eq(orgs.id, principal.orgId))
  return all.map((o) => ({ ...o, role: 'admin' as Role }))
}

/** `principal`'s role in `orgId`, or undefined when it has none. */
export async function roleIn(principal: Principal, orgId: string): Promise<Role | undefined> {
  if (principal.kind === 'key') return principal.orgId === orgId ? 'admin' : undefined
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, principal.user.id)))
  return row?.role
}
