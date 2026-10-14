import { eq, inArray } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import {
  type AuthEnv,
  atLeast,
  newToken,
  orgsOf,
  type Principal,
  requireAuth,
  roleIn,
} from '../auth'
import { clickhouse } from '../db/clickhouse'
import { db } from '../db/postgres'
import { type Role, type Site, sites } from '../db/schema'
import { normalizeDomain, validTimezone } from '../domain'
import { playable, recordingOf } from '../replay/sessions'
import { forgetDomain } from '../sites'
import { rows } from '../stats/queries'
import { funnelRoutes, goalRoutes } from './goals'
import { revenueRoutes } from './revenue'
import { statsRoutes } from './stats'

export type SiteEnv = AuthEnv & { Variables: { site: Site; role: Role } }

export const adminRoutes = new Hono<SiteEnv>()

adminRoutes.use('/api/sites', requireAuth)
adminRoutes.use('/api/sites/*', requireAuth)
adminRoutes.use(
  '/api/sites',
  bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: 'too large' }, 413) }),
)

/** A site the caller can see, and the caller's role in the org that owns it. */
adminRoutes.use('/api/sites/:id/*', async (c, next) => {
  const id = c.req.param('id') ?? ''
  if (!z.uuid().safeParse(id).success) return c.json({ error: 'invalid site' }, 400)
  const site = await db.query.sites.findFirst({ where: eq(sites.id, id) })
  const role = site && (await roleIn(c.get('principal'), site.orgId))
  // A site in someone else's org is reported missing rather than forbidden.
  if (!site || !role) return c.json({ error: 'not found' }, 404)
  c.set('site', site)
  c.set('role', role)
  await next()
})

/**
 * Every site the caller can see, with its role there and when its first event happened (null
 * before any), for the "All time" range.
 */
adminRoutes.get('/api/sites', async (c) => {
  const orgs = await orgsOf(c.get('principal'))
  const roles = new Map(orgs.map((o) => [o.id, o.role]))
  const visible = orgs.length
    ? await db
        .select()
        .from(sites)
        .where(inArray(sites.orgId, [...roles.keys()]))
        .orderBy(sites.domain)
    : []
  const firsts = visible.length
    ? await rows<{ site: string; first: string }>(
        `SELECT toString(site_id) AS site,
                formatDateTime(min(timestamp), '%Y-%m-%dT%H:%i:%SZ', 'UTC') AS first
         FROM events WHERE site_id IN {ids:Array(UUID)} GROUP BY site_id`,
        { ids: visible.map((s) => s.id) },
      )
    : []
  const firstBySite = new Map(firsts.map((f) => [f.site, f.first]))
  return c.json(
    visible.map((s) => ({
      ...s,
      role: roles.get(s.orgId),
      // Only admins hand out the public link.
      shareToken: atLeast(roles.get(s.orgId), 'admin') ? s.shareToken : null,
      firstEvent: firstBySite.get(s.id) ?? null,
    })),
  )
})

const Domain = z
  .string()
  .max(300)
  .transform((d, ctx) => {
    const domain = normalizeDomain(d)
    if (!domain) ctx.addIssue({ code: 'custom', message: 'Enter a domain like example.com' })
    return domain ?? z.NEVER
  })
const Name = z.string().trim().min(1).max(100)
const Timezone = z.string().max(64).refine(validTimezone, 'Unknown timezone')
const Currency = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'Use a three-letter currency code')
  .transform((c) => c.toUpperCase())

const NewSite = z.object({
  domain: Domain,
  name: Name.optional(),
  timezone: Timezone.default('UTC'),
  currency: Currency.default('USD'),
  ai: z.boolean().default(false),
  /** Needed only when the caller administers more than one org. */
  org: z.uuid().optional(),
})

/** The org a new site goes to: the one asked for, or the caller's only org it administers. */
async function targetOrg(principal: Principal, asked: string | undefined) {
  if (asked) return atLeast(await roleIn(principal, asked), 'admin') ? asked : undefined
  const mine = (await orgsOf(principal)).filter((o) => atLeast(o.role, 'admin'))
  return mine.length === 1 ? mine[0]?.id : undefined
}

adminRoutes.post('/api/sites', async (c) => {
  const parsed = NewSite.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const { domain, name, timezone, currency, ai, org } = parsed.data
  const orgId = await targetOrg(c.get('principal'), org)
  if (!orgId)
    return c.json({ error: org ? 'not allowed' : 'say which org with "org"' }, org ? 403 : 400)
  const [site] = await db
    .insert(sites)
    .values({ orgId, domain, name: name ?? domain, timezone, currency, ai })
    .onConflictDoNothing()
    .returning()
  if (!site) return c.json({ error: `${domain} is already added` }, 409)
  forgetDomain(domain)
  return c.json({ ...site, role: await roleIn(c.get('principal'), orgId), firstEvent: null }, 201)
})

const SiteChange = z
  .object({ name: Name, timezone: Timezone, currency: Currency, ai: z.boolean() })
  .partial()

const forbidden = (c: Context) => c.json({ error: 'not allowed' }, 403)

/** Renames a site, moves its timezone or currency, or turns the model's reading on or off. */
adminRoutes.patch('/api/sites/:id', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const parsed = SiteChange.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const site = c.get('site')
  const [updated] = Object.keys(parsed.data).length
    ? await db.update(sites).set(parsed.data).where(eq(sites.id, site.id)).returning()
    : [site]
  return updated ? c.json({ ...updated, role: c.get('role') }) : c.json({ error: 'not found' }, 404)
})

/** Makes a new public link, which retires the old one. */
adminRoutes.put('/api/sites/:id/share', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const [site] = await db
    .update(sites)
    .set({ shareToken: newToken().slice(0, 22) })
    .where(eq(sites.id, c.get('site').id))
    .returning()
  return site ? c.json({ ...site, role: c.get('role') }) : c.json({ error: 'not found' }, 404)
})

adminRoutes.delete('/api/sites/:id/share', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const [site] = await db
    .update(sites)
    .set({ shareToken: null })
    .where(eq(sites.id, c.get('site').id))
    .returning()
  return site ? c.json({ ...site, role: c.get('role') }) : c.json({ error: 'not found' }, 404)
})

/** Tables in ClickHouse keyed by site, whose rows go with the site. */
const SITE_TABLES = ['events', 'ai_crawls', 'payments', 'replay_chunks', 'replay_sessions']

/**
 * Deletes a site and everything recorded for it. The site goes first, so ingestion stops; its
 * rows in ClickHouse are then removed in the background, as ClickHouse deletes are.
 */
adminRoutes.delete('/api/sites/:id', async (c) => {
  if (!atLeast(c.get('role'), 'admin')) return forbidden(c)
  const site = c.get('site')
  await db.delete(sites).where(eq(sites.id, site.id))
  forgetDomain(site.domain)
  for (const table of SITE_TABLES)
    await clickhouse.command({
      query: `ALTER TABLE ${table} DELETE WHERE site_id = {site:UUID}`,
      query_params: { site: site.id },
    })
  return c.json({ ok: true })
})

adminRoutes.route('/api/sites/:id/stats', statsRoutes)
adminRoutes.route('/api/sites/:id/revenue', revenueRoutes)
adminRoutes.route('/api/sites/:id/goals', goalRoutes)
adminRoutes.route('/api/sites/:id/funnels', funnelRoutes)

/** A session's recording, for the replay player. Offsets count from its first event. */
adminRoutes.get('/api/sites/:id/replays/:session', async (c) => {
  const session = c.req.param('session')
  if (!/^\d{1,20}$/.test(session)) return c.json({ error: 'invalid session' }, 400)
  const recording = await recordingOf(c.get('site').id, session).catch(() => undefined)
  const events = recording && playable(recording.loads)
  if (!events?.length) return c.json({ error: 'not found' }, 404)
  return c.json({ events })
})
