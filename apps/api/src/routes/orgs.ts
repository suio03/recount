import { and, desc, eq, gt, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  type AuthEnv,
  atLeast,
  canAssign,
  hashToken,
  newApiKey,
  newToken,
  requireAuth,
  roleIn,
} from '../auth'
import { db } from '../db/postgres'
import { apiKeys, invites, memberships, orgs, type Role, users } from '../db/schema'
import { Email } from './account'

/** An org's name, members, invites and API keys. */
export const orgRoutes = new Hono<AuthEnv & { Variables: { orgId: string; role: Role } }>()

const INVITE_DAYS = 7

orgRoutes.use('/api/orgs/*', requireAuth)
orgRoutes.use(
  '/api/orgs/*',
  bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'too large' }, 413) }),
)

/** Every org route needs at least a viewer's role; the caller's role is kept for the checks. */
orgRoutes.use('/api/orgs/:org/*', async (c, next) => {
  const orgId = c.req.param('org') ?? ''
  if (!z.uuid().safeParse(orgId).success) return c.json({ error: 'invalid org' }, 400)
  const role = await roleIn(c.get('principal'), orgId)
  if (!role) return c.json({ error: 'not found' }, 404)
  c.set('orgId', orgId)
  c.set('role', role)
  await next()
})

const forbidden = (c: Context) => c.json({ error: 'not allowed' }, 403)

async function body<T extends z.ZodType>(c: Context, schema: T) {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  return parsed.success
    ? ({ ok: true, data: parsed.data } as const)
    : ({ ok: false, error: c.json({ error: z.prettifyError(parsed.error) }, 400) } as const)
}

const RoleSchema = z.enum(['owner', 'admin', 'viewer'])

orgRoutes.patch('/api/orgs/:org', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(100) }))
  if (!input.ok) return input.error
  const [org] = await db
    .update(orgs)
    .set({ name: input.data.name })
    .where(eq(orgs.id, c.get('orgId')))
    .returning()
  return c.json(org)
})

/** Members and pending invites. Every member may see who else is in the org. */
orgRoutes.get('/api/orgs/:org/members', async (c) => {
  const orgId = c.get('orgId')
  const [members, pending] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: memberships.role,
        joinedAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.orgId, orgId))
      .orderBy(memberships.createdAt),
    db
      .select({
        id: invites.id,
        email: invites.email,
        role: invites.role,
        expiresAt: invites.expiresAt,
      })
      .from(invites)
      .where(and(eq(invites.orgId, orgId), gt(invites.expiresAt, new Date())))
      .orderBy(invites.createdAt),
  ])
  return c.json({ members, invites: pending })
})

/**
 * Invites someone by email. There is no mail yet, so the response carries the link's token once
 * and the inviter passes the link on. Inviting the same email again replaces the old link.
 */
orgRoutes.post('/api/orgs/:org/invites', async (c) => {
  const input = await body(c, z.object({ email: Email, role: RoleSchema }))
  if (!input.ok) return input.error
  const { email, role } = input.data
  if (!canAssign(c.get('role'), role)) return forbidden(c)
  const orgId = c.get('orgId')
  const [member] = await db
    .select({ id: users.id })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, orgId), eq(sql`lower(${users.email})`, email)))
  if (member) return c.json({ error: 'already a member' }, 409)
  const token = newToken()
  const principal = c.get('principal')
  const values = {
    orgId,
    email,
    role,
    tokenHash: hashToken(token),
    invitedBy: principal.kind === 'user' ? principal.user.id : null,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
  }
  const invite = await db.transaction(async (tx) => {
    await tx
      .delete(invites)
      .where(and(eq(invites.orgId, orgId), eq(sql`lower(${invites.email})`, email)))
    const [row] = await tx.insert(invites).values(values).returning({
      id: invites.id,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
    })
    return row
  })
  return c.json({ ...invite, token }, 201)
})

orgRoutes.delete('/api/orgs/:org/invites/:id', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json({ error: 'invalid invite' }, 400)
  const [gone] = await db
    .delete(invites)
    .where(and(eq(invites.id, id), eq(invites.orgId, c.get('orgId'))))
    .returning({ id: invites.id })
  return gone ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)
})

/**
 * Applies `change` to a member when the caller may, keeping at least one owner. Runs under a
 * lock on the org's memberships so two owners cannot demote each other at once.
 */
async function changeMember(
  c: Context<AuthEnv & { Variables: { orgId: string; role: Role } }>,
  next: Role | null,
) {
  const orgId = c.get('orgId')
  const userId = c.req.param('user') ?? ''
  if (!z.uuid().safeParse(userId).success) return c.json({ error: 'invalid member' }, 400)
  const principal = c.get('principal')
  const self = principal.kind === 'user' && principal.user.id === userId
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ user_id: string; role: Role }>(
      sql`SELECT user_id, role FROM memberships WHERE org_id = ${orgId} FOR UPDATE`,
    )
    const target = rows.find((r) => r.user_id === userId)
    if (!target) return c.json({ error: 'not found' }, 404)
    // A person's role may have changed while this request waited for the lock; a key has no
    // membership row, so its role from the start still holds.
    const actor =
      principal.kind === 'user'
        ? rows.find((r) => r.user_id === principal.user.id)?.role
        : c.get('role')
    if (!actor) return c.json({ error: 'not found' }, 404)
    // Anyone may leave; anything else needs the right to both the old role and the new one.
    const leaving = self && next === null
    if (!leaving && !(canAssign(actor, target.role) && (next === null || canAssign(actor, next))))
      return forbidden(c)
    const owners = rows.filter((r) => r.role === 'owner').length
    if (target.role === 'owner' && next !== 'owner' && owners === 1)
      return c.json({ error: 'an org needs an owner' }, 409)
    const where = and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))
    if (next === null) await tx.delete(memberships).where(where)
    else await tx.update(memberships).set({ role: next }).where(where)
    return c.json({ ok: true })
  })
}

orgRoutes.patch('/api/orgs/:org/members/:user', async (c) => {
  const input = await body(c, z.object({ role: RoleSchema }))
  if (!input.ok) return input.error
  return changeMember(c, input.data.role)
})

orgRoutes.delete('/api/orgs/:org/members/:user', (c) => changeMember(c, null))

orgRoutes.get('/api/orgs/:org/keys', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const keys = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.orgId, c.get('orgId')))
    .orderBy(desc(apiKeys.createdAt))
  return c.json(keys)
})

/** Creates a key for scripts. The key itself is in this response only; just its hash is kept. */
orgRoutes.post('/api/orgs/:org/keys', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const input = await body(c, z.object({ name: z.string().trim().min(1).max(100) }))
  if (!input.ok) return input.error
  const { key, hash, prefix } = newApiKey()
  const principal = c.get('principal')
  const [row] = await db
    .insert(apiKeys)
    .values({
      orgId: c.get('orgId'),
      name: input.data.name,
      keyHash: hash,
      prefix,
      createdBy: principal.kind === 'user' ? principal.user.id : null,
    })
    .returning({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
    })
  return c.json({ ...row, key }, 201)
})

orgRoutes.delete('/api/orgs/:org/keys/:id', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const id = c.req.param('id')
  if (!z.uuid().safeParse(id).success) return c.json({ error: 'invalid key' }, 400)
  const [gone] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.orgId, c.get('orgId'))))
    .returning({ id: apiKeys.id })
  return gone ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)
})
