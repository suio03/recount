import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  type AuthEnv,
  blocked,
  checkAdminToken,
  endOtherSessions,
  endSession,
  fail,
  hashToken,
  orgsOf,
  requireAuth,
  startSession,
} from '../auth'
import { db } from '../db/postgres'
import { invites, memberships, orgs, users } from '../db/schema'
import { decoy, hashPassword, verifyPassword } from '../passwords'

/** Signing in, the first account, the signed-in person's own settings and accepting invites. */
export const accountRoutes = new Hono<AuthEnv>()

const small = bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'too large' }, 413) })
accountRoutes.use('/api/setup', small)
accountRoutes.use('/api/login', small)
accountRoutes.use('/api/me', small)
accountRoutes.use('/api/invites/*', small)

export const Email = z
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase())
const Password = z.string().min(10, 'Use at least 10 characters').max(200)
const Name = z.string().trim().min(1).max(100)

async function body<T extends z.ZodType>(c: Context, schema: T) {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success
    ? ({ ok: true, data: parsed.data } as const)
    : ({ ok: false, error: c.json({ error: z.prettifyError(parsed.error) }, 400) } as const)
}

const userByEmail = (email: string) =>
  db.query.users.findFirst({ where: eq(sql`lower(${users.email})`, email) })

const publicUser = (u: { id: string; email: string; name: string }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
})

/** Whether the instance still needs its first account. */
accountRoutes.get('/api/setup', async (c) => {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
  return c.json({ needed: (row?.n ?? 0) === 0 })
})

const Setup = z.object({
  adminToken: z.string().max(500),
  email: Email,
  name: Name,
  password: Password,
})

/**
 * Creates the first account, as owner. ADMIN_TOKEN proves the person owns the server, so a
 * stranger cannot claim a fresh install first. Sites from before accounts are in an org nobody
 * belongs to yet, which the owner takes over.
 */
accountRoutes.post('/api/setup', async (c) => {
  const input = await body(c, Setup)
  if (!input.ok) return input.error
  const check = checkAdminToken(c, input.data.adminToken)
  if (check === 'blocked') return c.json({ error: 'too many attempts' }, 429)
  if (check === 'wrong') return c.json({ error: 'wrong admin token' }, 401)
  const { email, name, password } = input.data
  const passwordHash = await hashPassword(password)
  const user = await db.transaction(async (tx) => {
    // Two setups at once must not both find no users.
    await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`)
    const [existing] = await tx.select({ id: users.id }).from(users).limit(1)
    if (existing) return undefined
    const [created] = await tx.insert(users).values({ email, name, passwordHash }).returning()
    if (!created) throw new Error('user not created')
    const [orphan] = await tx
      .select({ id: orgs.id })
      .from(orgs)
      .leftJoin(memberships, eq(memberships.orgId, orgs.id))
      .where(isNull(memberships.orgId))
      .orderBy(orgs.createdAt)
      .limit(1)
    const orgId =
      orphan?.id ??
      (
        await tx
          .insert(orgs)
          .values({ name: `${name}'s sites` })
          .returning()
      )[0]?.id
    if (!orgId) throw new Error('org not created')
    await tx.insert(memberships).values({ orgId, userId: created.id, role: 'owner' })
    return created
  })
  if (!user) return c.json({ error: 'already set up' }, 409)
  await startSession(c, user.id)
  return c.json(publicUser(user), 201)
})

const Login = z.object({ email: Email, password: z.string().max(200) })

accountRoutes.post('/api/login', async (c) => {
  const input = await body(c, Login)
  if (!input.ok) return input.error
  if (blocked(c)) return c.json({ error: 'too many attempts' }, 429)
  const user = await userByEmail(input.data.email)
  // A missing account costs the same time as a wrong password, so emails cannot be probed.
  const ok = await verifyPassword(input.data.password, user?.passwordHash ?? decoy)
  if (!user || !ok) {
    fail(c)
    return c.json({ error: 'wrong email or password' }, 401)
  }
  await startSession(c, user.id)
  return c.json(publicUser(user))
})

accountRoutes.post('/api/logout', async (c) => {
  await endSession(c)
  return c.json({ ok: true })
})

accountRoutes.use('/api/me', requireAuth)

/** The caller and its orgs. Scripts with a token have no user. */
accountRoutes.get('/api/me', async (c) => {
  const principal = c.get('principal')
  return c.json({
    user: principal.kind === 'user' ? publicUser(principal.user) : null,
    orgs: await orgsOf(principal),
  })
})

const MeChange = z.object({
  name: Name.optional(),
  password: z.object({ current: z.string().max(200), next: Password }).optional(),
})

/** Changes the signed-in person's name or password. A new password signs other browsers out. */
accountRoutes.patch('/api/me', async (c) => {
  const principal = c.get('principal')
  if (principal.kind !== 'user') return c.json({ error: 'not a person' }, 400)
  const input = await body(c, MeChange)
  if (!input.ok) return input.error
  const { name, password } = input.data
  const change: Partial<typeof users.$inferInsert> = {}
  if (name) change.name = name
  if (password) {
    if (blocked(c)) return c.json({ error: 'too many attempts' }, 429)
    if (!(await verifyPassword(password.current, principal.user.passwordHash))) {
      fail(c)
      return c.json({ error: 'wrong current password' }, 401)
    }
    change.passwordHash = await hashPassword(password.next)
  }
  if (Object.keys(change).length === 0) return c.json(publicUser(principal.user))
  const [user] = await db
    .update(users)
    .set(change)
    .where(eq(users.id, principal.user.id))
    .returning()
  if (!user) return c.json({ error: 'not found' }, 404)
  if (password) await endOtherSessions(c, user.id)
  return c.json(publicUser(user))
})

const liveInvite = (token: string) =>
  db
    .select({ invite: invites, org: orgs.name })
    .from(invites)
    .innerJoin(orgs, eq(orgs.id, invites.orgId))
    .where(and(eq(invites.tokenHash, hashToken(token)), gt(invites.expiresAt, new Date())))
    .then((rows) => rows[0])

/** What an invite link is for, so the page can ask for a password or for a new account. */
accountRoutes.get('/api/invites/:token', async (c) => {
  const found = await liveInvite(c.req.param('token'))
  if (!found) return c.json({ error: 'invite not found or expired' }, 404)
  const { invite, org } = found
  return c.json({
    org,
    email: invite.email,
    role: invite.role,
    hasAccount: (await userByEmail(invite.email)) !== undefined,
  })
})

const Accept = z.object({ password: z.string().max(200), name: Name.optional() })

/**
 * Joins the invite's org: someone with an account signs in with its password, someone new
 * creates one. Either way the browser ends up signed in as the invited email.
 */
accountRoutes.post('/api/invites/:token', async (c) => {
  const input = await body(c, Accept)
  if (!input.ok) return input.error
  const found = await liveInvite(c.req.param('token'))
  if (!found) return c.json({ error: 'invite not found or expired' }, 404)
  const { invite } = found
  let user = await userByEmail(invite.email)
  if (user) {
    if (blocked(c)) return c.json({ error: 'too many attempts' }, 429)
    if (!(await verifyPassword(input.data.password, user.passwordHash))) {
      fail(c)
      return c.json({ error: 'wrong password' }, 401)
    }
  } else {
    const password = Password.safeParse(input.data.password)
    if (!password.success) return c.json({ error: z.prettifyError(password.error) }, 400)
    if (!input.data.name) return c.json({ error: 'name is required' }, 400)
    user = (
      await db
        .insert(users)
        .values({
          email: invite.email,
          name: input.data.name,
          passwordHash: await hashPassword(password.data),
        })
        .returning()
    )[0]
    if (!user) throw new Error('user not created')
  }
  const userId = user.id
  await db.transaction(async (tx) => {
    await tx
      .insert(memberships)
      .values({ orgId: invite.orgId, userId, role: invite.role })
      .onConflictDoNothing()
    await tx.delete(invites).where(eq(invites.id, invite.id))
  })
  await startSession(c, userId)
  return c.json({ orgId: invite.orgId })
})
