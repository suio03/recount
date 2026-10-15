import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import { atLeast } from '../auth'
import { db } from '../db/postgres'
import { funnels, goals } from '../db/schema'
import { dismiss, undismiss } from '../semantics/store'
import { BUILT_IN_EVENTS, GoalMatch, MAX_FUNNELS, MAX_GOALS, Match } from '../stats/goals'
import { rows } from '../stats/queries'
import type { SiteEnv } from './admin'

/** A site's defined goals and funnels. Members read them; admins add and delete them. */
export const goalRoutes = new Hono<SiteEnv>()
export const funnelRoutes = new Hono<SiteEnv>()

/** Custom events seen this recently are offered as funnel steps. */
const EVENT_DAYS = 90

for (const routes of [goalRoutes, funnelRoutes]) {
  routes.use(bodyLimit({ maxSize: 8192, onError: (c) => c.json({ error: 'too large' }, 413) }))
  routes.use('/*', async (c, next) => {
    if (c.req.method !== 'GET' && !atLeast(c.get('role'), 'admin'))
      return c.json({ error: 'not allowed' }, 403)
    await next()
  })
}

const Name = z.string().trim().min(1).max(120)

/** Defined goals, and the custom events of the last 90 days, which are goals without defining. */
goalRoutes.get('/', async (c) => {
  const site = c.get('site')
  const [defined, events] = await Promise.all([
    db.select().from(goals).where(eq(goals.siteId, site.id)).orderBy(goals.createdAt),
    rows<{ name: string }>(
      `SELECT DISTINCT name FROM events
       WHERE site_id = {site:UUID} AND timestamp >= now() - INTERVAL {days:UInt32} DAY
         AND name NOT IN ('pageview', 'click')
       ORDER BY name`,
      { site: site.id, days: EVENT_DAYS },
    ),
  ])
  return c.json({
    goals: defined.map(({ id, name, match, drafted }) => ({ id, name, match, drafted })),
    events: events.map((e) => e.name),
  })
})

const NewGoal = z.object({
  name: Name.refine((n) => !BUILT_IN_EVENTS.includes(n), 'That name is taken by built-in events'),
  match: GoalMatch,
})

goalRoutes.post('/', async (c) => {
  const parsed = NewGoal.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const siteId = c.get('site').id
  if ((await db.$count(goals, eq(goals.siteId, siteId))) >= MAX_GOALS)
    return c.json({ error: `A site can have up to ${MAX_GOALS} goals` }, 400)
  const [goal] = await db
    .insert(goals)
    .values({ siteId, ...parsed.data })
    .onConflictDoNothing()
    .returning()
  if (!goal) return c.json({ error: `There is already a goal named ${parsed.data.name}` }, 409)
  await undismiss(siteId, 'goal', goal.name)
  return c.json({ id: goal.id, name: goal.name, match: goal.match, drafted: false }, 201)
})

/**
 * Deletes a goal. Funnels keep their own copy of its rule, so they are unchanged. Drafts do not
 * add a goal of that name again on their own.
 */
goalRoutes.delete('/:goal', async (c) => {
  const id = c.req.param('goal')
  if (!z.uuid().safeParse(id).success) return c.json({ error: 'not found' }, 404)
  const [gone] = await db
    .delete(goals)
    .where(and(eq(goals.id, id), eq(goals.siteId, c.get('site').id)))
    .returning()
  if (!gone) return c.json({ error: 'not found' }, 404)
  await dismiss(gone.siteId, 'goal', gone.name)
  return c.json({ ok: true })
})

funnelRoutes.get('/', async (c) =>
  c.json(
    await db
      .select({
        id: funnels.id,
        name: funnels.name,
        steps: funnels.steps,
        drafted: funnels.drafted,
      })
      .from(funnels)
      .where(eq(funnels.siteId, c.get('site').id))
      .orderBy(funnels.createdAt),
  ),
)

const NewFunnel = z.object({
  name: Name,
  steps: z
    .array(z.object({ name: Name, match: Match }))
    .min(2, 'A funnel needs at least two steps')
    .max(8, 'A funnel can have up to eight steps'),
})

funnelRoutes.post('/', async (c) => {
  const parsed = NewFunnel.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: z.prettifyError(parsed.error) }, 400)
  const siteId = c.get('site').id
  if ((await db.$count(funnels, eq(funnels.siteId, siteId))) >= MAX_FUNNELS)
    return c.json({ error: `A site can have up to ${MAX_FUNNELS} funnels` }, 400)
  const [funnel] = await db
    .insert(funnels)
    .values({ siteId, ...parsed.data })
    .onConflictDoNothing()
    .returning()
  if (!funnel) return c.json({ error: `There is already a funnel named ${parsed.data.name}` }, 409)
  await undismiss(siteId, 'funnel', funnel.name)
  return c.json({ id: funnel.id, name: funnel.name, steps: funnel.steps, drafted: false }, 201)
})

funnelRoutes.delete('/:funnel', async (c) => {
  const id = c.req.param('funnel')
  if (!z.uuid().safeParse(id).success) return c.json({ error: 'not found' }, 404)
  const [gone] = await db
    .delete(funnels)
    .where(and(eq(funnels.id, id), eq(funnels.siteId, c.get('site').id)))
    .returning()
  if (!gone) return c.json({ error: 'not found' }, 404)
  await dismiss(gone.siteId, 'funnel', gone.name)
  return c.json({ ok: true })
})
