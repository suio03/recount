import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { clientIp } from './client-ip'
import { db } from './db/postgres'
import { apiKeys, memberships, orgs, type Role, type User, userSessions, users } from './db/schema'
import { env } from './env'

/**
 * Who is calling the private API:
 * - a person, through the session cookie the dashboard gets at sign-in;
 * - a script with an org's API key (`Bearer rc_...`), acting as an admin of that org;
 * - a script with ADMIN_TOKEN, which may do anything. It stays while scripts move to API keys,
 *   and it proves ownership when the first account is created.
 */
export type Principal =
  | { kind: 'user'; user: User }
  | { kind: 'key'; orgId: string }
  | { kind: 'admin' }

export type AuthEnv = { Variables: { principal: Principal } }

const COOKIE = 'rc_session'
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
 * Wrong passwords and tokens are capped per address, and across all addresses, since anyone who
 * can reach the server directly can claim any address. An open-source install may run with a
 * weak ADMIN_TOKEN, and people pick weak passwords.
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

type Check = 'ok' | 'wrong' | 'blocked'

/** Checks a secret against ADMIN_TOKEN, counting wrong ones; while blocked nothing is checked. */
export function checkAdminToken(c: Context, secret: string): Check {
  if (blocked(c)) return 'blocked'
  if (same(secret, env.ADMIN_TOKEN)) return 'ok'
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

type Resolved = Principal | 'missing' | 'wrong' | 'blocked'

async function resolve(c: Context): Promise<Resolved> {
  const header = c.req.header('Authorization')
  if (header?.startsWith('Bearer ')) {
    const secret = header.slice(7)
    // Keys are 32 random bytes, so they cannot be guessed and are not counted.
    if (secret.startsWith(KEY_PREFIX)) return (await fromKey(secret)) ?? 'wrong'
    const result = checkAdminToken(c, secret)
    return result === 'ok' ? { kind: 'admin' } : result
  }
  const cookie = getCookie(c, COOKIE)
  if (cookie === undefined) return 'missing'
  const principal = await fromSession(cookie)
  if (principal) return principal
  // Expired or signed out elsewhere: drop it so the browser stops sending it.
  deleteCookie(c, COOKIE, { path: '/' })
  return 'wrong'
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
}

export async function endSession(c: Context) {
  const token = getCookie(c, COOKIE)
  if (token !== undefined)
    await db.delete(userSessions).where(eq(userSessions.tokenHash, hashToken(token)))
  deleteCookie(c, COOKIE, { path: '/' })
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
    .where(principal.kind === 'key' ? eq(orgs.id, principal.orgId) : undefined)
    .orderBy(orgs.createdAt)
  const role: Role = principal.kind === 'key' ? 'admin' : 'owner'
  return all.map((o) => ({ ...o, role }))
}

/** `principal`'s role in `orgId`, or undefined when it has none. */
export async function roleIn(principal: Principal, orgId: string): Promise<Role | undefined> {
  if (principal.kind === 'admin') return 'owner'
  if (principal.kind === 'key') return principal.orgId === orgId ? 'admin' : undefined
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, principal.user.id)))
  return row?.role
}
